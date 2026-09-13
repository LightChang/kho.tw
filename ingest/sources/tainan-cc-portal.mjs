// ingest/sources/tainan-cc-portal.mjs
// 臺南市社區大學校務資訊系統－週課表。一個站台掛七所社大，`Index.php?Com=<slug>` 切換，
// 伺服器端週課表 HTML、不分頁，一格一門課（實測 0 格有兩門課的情況）。
//
// ⚠ 七校期別各走各的（實測 2026-09-13）：
//   曾文 503（115年度秋季班，唯一當期）／臺南 301（114年度秋季班）／北門 104（115年度春季班）
//   新化 96（115年度春季班）／南關 80（114年度春季班）／永康 76（115年度春季班）／新營 0（無課程）
//
// 處置：**七校全收 1,160 門，期別逐校標清楚**，不是只收曾文。理由三點：
//   1. 期別是每校頁面自己宣告的（`.SubTitle02` 寫「115年度 秋季班」），逐校讀進 `termText`，
//      normalize 據此填 `term.year`／`term.season`，舊期別不會被冒充成當期。
//   2. 每一格都有「上課日期:2026-03-02~2026-07-17」，`schedule.startDate`／`endDate` 全部
//      是來源直給的值，下游要濾掉已結束的期別有足夠依據，不必靠猜。
//   3. 既有來源本來就含舊期別——moe-cc-courses 13,010 門裡 12,189 門上課日期已過、
//      taipei-cc 含 114學年度第2學期 30 門。只收曾文會丟掉另外六校 657 門，卻換不到一致性。
//
// 反過來說，**這支不是即時層**：沒有報名狀態、沒有已報名人數、沒有剩餘名額，
// 一律不填 `enrollment.capacity`／`available`（見 ingest/CONTRACT.md §5）。列表唯一的狀態
// 旗標是課名後的 `<span>[不開班]</span>`（北門 100 門、永康 76 門），那是停開。
//
// 詳情頁 `Modules/Course/Show.php?ID=<id>` 另有課程編號（`1152A01`，與全國站
// internal_course_code 同型、可當 cluster key）、人數上限／下限、學分費、上課週數，
// 但一課一次請求、1,160 門一輪 20 分鐘。照 taoyuan-cc-portal.mjs（1,206 門）的先例
// 不在每輪抓，L1 只帶列表層欄位；真要拿課程編號時另開一支補登腳本比較合理。
import { fetchWithRetry, htmlText, runAsScript } from './_util.mjs';

const BASE = 'https://tncu.tn.edu.tw';
const LIST = `${BASE}/System/main/Course/Index.php?Com=`;
const SHOW = `${BASE}/Modules/Course/Show.php?ID=`;
const DELAY_MS = 1100;

// slug → 校名。頁面 <select> 的 SELECTED 選項就是校名，解析不到時用這份備援。
const SCHOOLS = [
  ['Xinying', '新營社區大學'],
  ['Tsengwen', '曾文社區大學'],
  ['Beimen', '北門社區大學'],
  ['Xinhua', '新化社區大學'],
  ['Nanguan', '南關社區大學'],
  ['Yongkang', '永康社區大學'],
  ['Tainan', '臺南社區大學'],
];

export const meta = {
  id: 'tainan-cc-portal',
  name: '臺南市社區大學校務資訊系統－課程查詢',
  org: '臺南市政府教育局（新營、曾文、北門、新化、南關、永康、臺南七所社區大學）',
  homepage: 'https://tncu.tn.edu.tw/',
  license: 'UNVERIFIED（站方未標示）',
  updateFreq: 'UNVERIFIED（七校期別各自維護，實測僅曾文停在當期 115 年度秋季班）',
  format: 'html',
  entity: 'course',
  // 沒有名額也沒有報名狀態，不符合 course-live 的定義（CONTRACT §3）；六校是靜態快照、
  // 只有曾文會換期，7 天一輪足夠。1、2、7、8 月是社大報名季，換期最可能發生在那時。
  cadence: { kind: 'course-archive', boostMonths: [1, 2, 7, 8] },
  endpoints: SCHOOLS.map(([slug]) => `${LIST}${slug}`),
  recordCount: 1160, // 實測 2026-09-13：503／301／104／96／80／76／0（曾文／臺南／北門／新化／南關／永康／新營）
  verifiedAt: '2026-09-13',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 週課表那張表：<table … class='College_Table' …>，第一列是星期表頭。
// 表頭逐校不同（曾文一～日七欄、永康少了星期六），所以星期靠欄位對齊讀，不寫死。
function gridCells(html) {
  const table = html.match(/<table[^>]*class='College_Table'[\s\S]*?<\/table>/);
  if (!table) return { header: [], rows: [] };
  const trs = [...table[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)];
  if (trs.length === 0) return { header: [], rows: [] };
  const tds = (tr) => [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
  return {
    header: tds(trs[0][1]).map((c) => htmlText(c)),
    rows: trs.slice(1).map((tr) => tds(tr[1])),
  };
}

// 一格長這樣：
// <font><a href="javascript:newin(900,700,'…/Show.php?ID=20709')">瑜珈提斯-脊椎保健運動</a>
//   <div align='center'>上課日期:2026-08-24~2027-01-30<br>上課時間:08:50~10:30<br>授課教師:林桓立</div>
//   <div align='center' style='color:#db2400;'></div></font>
// 停開的課把最後那個紅字 div 換成 <span>[不開班]</span>。
export function parseIndex(html, slug, schoolName, termText) {
  const { header, rows } = gridCells(html);
  const out = [];
  for (const cells of rows) {
    cells.forEach((cell, col) => {
      const courseId = cell.match(/Show\.php\?ID=(\d+)/)?.[1];
      if (!courseId) return;
      const title = htmlText(cell.match(/Show\.php\?ID=\d+'\)"\s*>([\s\S]*?)<\/a>/)?.[1] ?? '');
      if (!title) return;
      const info = cell.match(
        /上課日期\s*:\s*([^<]*)<br>\s*上課時間\s*:\s*([^<]*)<br>\s*授課教師\s*:\s*([^<]*)/,
      );
      out.push({
        courseId,
        title,
        schoolSlug: slug,
        schoolName,
        termText,
        gridWeekdayText: header[col] ?? '',
        dateText: htmlText(info?.[1] ?? ''),
        timeText: htmlText(info?.[2] ?? ''),
        teacherText: htmlText(info?.[3] ?? ''),
        // 紅字 div 在別的社大系統放教室名，臺南七校實測 1,160 門全是空的，仍照抓不猜。
        roomText: htmlText(cell.match(/color:#db2400;'>([\s\S]*?)<\/div>/)?.[1] ?? ''),
        statusRaw: /\[不開班\]/.test(cell) ? '[不開班]' : '',
        url: `${SHOW}${courseId}`,
      });
    });
  }
  return out;
}

export async function fetchRaw() {
  const byId = new Map();
  for (const [slug, fallbackName] of SCHOOLS) {
    let html;
    try {
      html = await (await fetchWithRetry(`${LIST}${slug}`)).text();
    } catch (err) {
      process.stderr.write(`[tainan-cc-portal] ${slug} 取得失敗：${err.message}\n`);
      await sleep(DELAY_MS);
      continue;
    }
    const schoolName = htmlText(
      html.match(new RegExp(`<option value="${slug}"[^>]*SELECTED[^>]*>([^<]*)</option>`, 'i'))?.[1] ?? '',
    ) || fallbackName;
    // SubTitle02 有兩個：頁面標題「課程查詢」與期別「115年度 秋季班」，取帶年度的那個。
    const termText = [...html.matchAll(/class="SubTitle02"[^>]*>([\s\S]*?)<\/div>/g)]
      .map((m) => htmlText(m[1]))
      .find((t) => /\d{3}\s*年度/.test(t)) ?? '';
    const rows = parseIndex(html, slug, schoolName, termText);
    for (const r of rows) if (!byId.has(r.courseId)) byId.set(r.courseId, r);
    process.stderr.write(
      `[tainan-cc-portal] ${slug} ${rows.length} 門（${schoolName}｜${termText || '無期別'}）\n`,
    );
    await sleep(DELAY_MS);
  }
  const out = [...byId.values()].sort((a, b) => Number(a.courseId) - Number(b.courseId));
  process.stderr.write(`[tainan-cc-portal] 合計 ${out.length} 門\n`);
  return out;
}

await runAsScript(import.meta.url, meta, fetchRaw);
