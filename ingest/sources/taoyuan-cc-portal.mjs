// ingest/sources/taoyuan-cc-portal.mjs
// 桃園市社區大學聯合網站－課程查詢。前端是純 JS 頁面，資料在 POST /front/search.php，
// 回傳 Bootstrap 卡片 HTML 片段，開頭帶「找到 <span>N</span> 筆」。
//
// 這支是桃園 5 所社大目前唯一拿得到的入口：`cc-shared-platform.mjs` HOSTS 裡的桃園 5 台
// 主機 2026-09-12 實測全部 503，那支的 raw 檔桃園是 0 筆（見 probe/2026-09-13-unresolved.md §1.2）。
//
// ⚠ 參數陷阱：空字串會被當成「有效的篩選值」而不是「不篩選」。
//   送 semester=''、category='' … 那組空字串 → 只回 192 筆（實測 2026-09-13）；
//   只送 offset 與 limit → 回全量 1,206 筆。所以下面刻意不送任何篩選欄位。
//
// 列表層沒有報名狀態、沒有已報名人數、沒有費用、沒有地址。
// 詳情頁 /front/course_detail.php?id=<32 hex> 另有招生人數與完整門牌，但一課一次請求、
// 1,206 課即一輪 20 分鐘（course-live 每 6 小時一輪），照 ntpc-cc.mjs 的先例不在每輪抓，
// L1 就只帶列表層欄位。
import { postForm, htmlText, runAsScript } from './_util.mjs';

const SEARCH = 'https://ta.twcc.org.tw/front/search.php';
const DETAIL = 'https://ta.twcc.org.tw/front/course_detail.php?id=';
const LIMIT = 2000;   // 實測一次回 1,206 筆（827 KB），無伺服器端截斷
const MAX_ROUNDS = 10;

export const meta = {
  id: 'taoyuan-cc-portal',
  name: '桃園社區大學聯合網站－課程查詢系統',
  org: '桃園市政府教育局',
  homepage: 'https://ta.twcc.org.tw/cc/',
  license: 'UNVERIFIED（站方未標示；robots.txt 回 404，內容是一段導向 icourse.com.tw 的 JS）',
  updateFreq: 'UNVERIFIED（實測含 115 秋與 116 春兩期，為即時層）',
  format: 'html',
  entity: 'course',
  cadence: { kind: 'course-live', boostMonths: [1, 2, 7, 8] },
  endpoints: [SEARCH],
  recordCount: 1206, // 實測 2026-09-13：115 秋 1,185、116 春 18、115 暑 3
  verifiedAt: '2026-09-13',
};

// 卡片長這樣（單引號屬性、標籤前有 emoji）：
// <div class='col-md-4 mb-4'><div class='card …' onclick="window.open('course_detail.php?id=<hash>', …)">
//   <h5 class='card-title'>📌 池坊花藝設計</h5>
//   <p class='card-text'><strong>🏢 主辦單位：</strong>桃園市中壢社區大學</p>
//   … 學期／類型／類別／開課日期 …
//   <p class='card-text text-danger'><strong>🔥 5 折</strong></p>   ← 優惠，非每張都有
function field(card, label) {
  const m = card.match(new RegExp(`${label}：</strong>([^<]*)<`));
  return m ? htmlText(m[1]) : '';
}

function parseCards(html) {
  const rows = [];
  for (const chunk of html.split("<div class='col-md-4 mb-4'>").slice(1)) {
    const id = chunk.match(/course_detail\.php\?id=([0-9a-f]{32})/)?.[1];
    if (!id) continue;
    const title = htmlText(chunk.match(/class='card-title'>([\s\S]*?)<\/h5>/)?.[1] ?? '')
      .replace(/^📌\s*/, '');
    // 開課日期欄是「2026-09-09 星期三 早上」三段合一
    const [startDate = '', weekdayText = '', timeOfDay = ''] = field(chunk, '開課日期').split(/\s+/);
    // 優惠 badge：text-danger 是折扣（🔥 5 折）、text-success 是免學分費（🎉 免學分費）
    const discountText = htmlText(
      chunk.match(/<p class='card-text text-(?:danger|success)'><strong>([\s\S]*?)<\/strong>/)?.[1] ?? '',
    );
    rows.push({
      courseId: id,
      courseName: title,
      organizer: field(chunk, '主辦單位'),
      semesterText: field(chunk, '學期'),
      courseTypeText: field(chunk, '類型'),
      categoryText: field(chunk, '類別'),
      startDate,
      weekdayText,
      timeOfDay,
      discountText,
      detailUrl: DETAIL + id,
    });
  }
  return rows;
}

export async function fetchRaw() {
  const out = [];
  const seen = new Set();
  for (let round = 0; round < MAX_ROUNDS; round++) {
    // 只送 offset 與 limit：多送一個空字串篩選欄位就會掉到 192 筆（見檔頭）
    const html = await postForm(SEARCH, { offset: round * LIMIT, limit: LIMIT });
    const total = Number(html.match(/找到\s*<span[^>]*>(\d+)<\/span>/)?.[1]);
    const rows = parseCards(html);
    for (const r of rows) {
      if (seen.has(r.courseId)) continue;
      seen.add(r.courseId);
      out.push(r);
    }
    process.stderr.write(`[taoyuan-cc-portal] offset ${round * LIMIT}：本批 ${rows.length} 筆，累計 ${out.length}／站方宣稱 ${total || '未知'}\n`);
    if (rows.length < LIMIT) break;
    await new Promise((r) => setTimeout(r, 1500)); // 同站序列請求，間隔 ≧1s
  }
  // 固定排序，讓 raw 檔的位元組不隨伺服器回傳順序變動
  return out.sort((a, b) => a.courseId.localeCompare(b.courseId));
}

await runAsScript(import.meta.url, meta, fetchRaw);
