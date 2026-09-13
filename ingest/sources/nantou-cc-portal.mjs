// ingest/sources/nantou-cc-portal.mjs
// 南投縣社區大學聯網。一個站台掛三所社大、11 個校區（貓羅溪 1–4、水沙連 5–7、濁水溪 8–11），
// 校區用 Unit=1..11 切換，每個校區一張伺服器端週課表，不分頁。
//
// 這支要打三種頁面，缺一不可：
// 1. Index.php?Unit=n          週課表格線，給課程 ID、課名、教師、教室。
//                              **星期是靠表頭欄位對齊的**：各校區的表頭不一樣
//                              （Unit=1 是一～五、Unit=4 是一二四六），所以逐欄讀表頭，不寫死。
// 2. course_immediate.php?Unit=n 即時選課，給「已選：24／剩餘：11」或「(已額滿)」。
//    這是本專案第五個拿得到數字型名額的來源。注意 Index_immediate.php?PID=6 只是外框，
//    不帶 Unit 時回空殼，資料在 course_immediate.php 這支。
// 3. Detail.php?ID=<id>        逐課詳情，給授課時間、招生人數(最高)、學分、週數、費用、課程概要。
//    週課表本身沒有上課時刻（只有頁首一句「星期一至星期五 晚上 6:30 至 9:20，其餘另行公告」
//    的通則），所以時刻只能從詳情頁拿。實測 218 門＝218 次請求，序列、間隔 1.1 秒。
//
// 名額語意（實測 ID=10953 對照過）：詳情頁「招生人數(最高)：35人」＝ 已選 24 ＋ 剩餘 11。
// 所以 capacity 用「招生人數(最高)」、available 用「剩餘」，兩者都是來源直接給的數字，不推算。
import { fetchWithRetry, htmlText, runAsScript } from './_util.mjs';

const BASE = 'https://ntcun.ntct.edu.tw/Modules/Course';
const UNITS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const DELAY_MS = 1100;

export const meta = {
  id: 'nantou-cc-portal',
  name: '南投縣社區大學聯網－課程一覽',
  org: '南投縣政府教育處（貓羅溪、水沙連、濁水溪三所社區大學）',
  homepage: 'https://ntcun.ntct.edu.tw/',
  license: 'UNVERIFIED（站方未標示）',
  updateFreq: 'UNVERIFIED（即時層，course_immediate.php 帶已選／剩餘名額）',
  format: 'html',
  entity: 'course',
  cadence: { kind: 'course-live', boostMonths: [1, 2, 7, 8] },
  endpoints: [
    ...UNITS.map((u) => `${BASE}/Index.php?Unit=${u}`),
    ...UNITS.map((u) => `${BASE}/course_immediate.php?Unit=${u}`),
  ],
  recordCount: 218, // 實測 2026-09-13：115 年度秋季班，11 校區 35/29/16/6/30/11/12/21/16/26/16
  verifiedAt: '2026-09-13',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WEEKDAY_LABEL = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

// 取週課表那張表：<table … class='College_Table' …>，第一列是星期表頭
function gridCells(html) {
  const table = html.match(/<table[^>]*class='College_Table'[\s\S]*?<\/table>/);
  if (!table) return { header: [], rows: [] };
  const trs = [...table[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)];
  if (trs.length === 0) return { header: [], rows: [] };
  const tds = (tr) => [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
  return { header: tds(trs[0][1]).map((c) => htmlText(c)), rows: trs.slice(1).map((tr) => tds(tr[1])) };
}

// <a href="javascript:newin(900,700,'../Course/Detail.php?ID=10953')">大家說英語</a>
//   <div align='center'>劉勃倫</div>
//   <div align='center' style='color:#db2400;'>漳興國小-3-1教室</div>
export function parseIndex(html, unit, unitName, termText, periodText) {
  const { header, rows } = gridCells(html);
  const out = [];
  for (const cells of rows) {
    cells.forEach((cell, col) => {
      const link = cell.match(/Detail\.php\?ID=(\d+)'\)"\s*>([\s\S]*?)<\/a>/);
      if (!link) return;
      // 教室那個 div 帶紅字樣式，教師那個沒有，用樣式區分才不會把兩者搞反
      const divs = [...cell.matchAll(/<div([^>]*)>([\s\S]*?)<\/div>/g)]
        .map((m) => ({ isRoom: /color:#db2400/.test(m[1]), text: htmlText(m[2]) }))
        .filter((d) => d.text);
      out.push({
        courseId: link[1],
        title: htmlText(link[2]),
        teacher: divs.find((d) => !d.isRoom)?.text ?? '',
        classroom: divs.find((d) => d.isRoom)?.text ?? '',
        gridWeekdayText: header[col] ?? '',
        unit: String(unit),
        unitName,
        termText,
        periodText,
      });
    });
  }
  return out;
}

// 即時選課格線：每格 <a …Detail.php?ID=…>課名</a> 後面接
//   <div class='online'>已選：24</div><div class='onsite'>剩餘：11</div>  或  <span>(已額滿)</span>
export function parseImmediate(html) {
  const { rows } = gridCells(html);
  const map = new Map();
  for (const cells of rows) {
    for (const cell of cells) {
      const id = cell.match(/Detail\.php\?ID=(\d+)/)?.[1];
      if (!id) continue;
      const after = htmlText(cell.replace(/^[\s\S]*?<\/a>/, ''));
      const enrolled = after.match(/已選\s*[:：]\s*(\d+)/)?.[1];
      const remaining = after.match(/剩餘\s*[:：]\s*(\d+)/)?.[1];
      const entry = { immediateText: after };
      if (enrolled !== undefined) entry.enrolledText = enrolled;
      if (remaining !== undefined) entry.remainingText = remaining;
      if (/已額滿/.test(after)) entry.fullFlag = '已額滿';
      map.set(id, entry);
    }
  }
  return map;
}

// 詳情頁是 label:</td><td>value</td> 的兩欄表，部分欄位擠在同一格用 <font> 內嵌
const cellAfter = (html, label) =>
  html.match(new RegExp(`${label}\\s*:\\s*</td>\\s*<td[^>]*>([\\s\\S]*?)</td>`))?.[1] ?? '';
const inlineAfter = (html, label) =>
  html.match(new RegExp(`${label}\\s*:\\s*</font>(?:&nbsp;)?([\\s\\S]*?)(?:</font>|</td>|<input|<br)`))?.[1] ?? '';
const digits = (s) => s.match(/(\d+)/)?.[1] ?? '';
// 同一格裡後面還跟著別的欄位時，只取第一個內嵌標籤之前的部分
const headOf = (s) => htmlText(s.split('<font')[0]);

export function parseDetail(html) {
  const pre = (label) => htmlText(cellAfter(html, label));
  return {
    detailTermText: htmlText(cellAfter(html, '班季')),
    schoolName: headOf(cellAfter(html, '校別')),
    campusName: htmlText(html.match(/校區<\/font>\s*:\s*([\s\S]*?)<input/)?.[1] ?? ''),
    detailTitle: htmlText(cellAfter(html, '課程名稱')),
    categoryText: headOf(cellAfter(html, '類別')),
    creditText: digits(inlineAfter(html, '學分')),
    hoursText: digits(inlineAfter(html, '授課時數')),
    groupText: htmlText(cellAfter(html, '學群')),
    venueText: headOf(cellAfter(html, '地點')),
    weeksText: digits(inlineAfter(html, '週數')),
    typeText: htmlText(inlineAfter(html, '類型')),
    teacherText: htmlText(cellAfter(html, '教師')),
    teacherBio: pre('教師簡介'),
    timeText: htmlText(cellAfter(html, '授課時間')),
    capacityText: digits(headOf(cellAfter(html, '招生人數\\(最高\\)'))),
    minEnrollText: digits(inlineAfter(html, '開班人數\\(最低\\)')),
    audienceText: pre('學員條件'),
    goalText: pre('教學目標'),
    outlineText: pre('課程概要'),
    assessText: pre('評量方式'),
    feeText: pre('課程相關費用'),
    reviewStatusText: htmlText(cellAfter(html, '審核狀態')),
  };
}

export async function fetchRaw() {
  const listed = new Map(); // courseId -> 週課表列（同課出現多格時只留第一格）
  const quota = new Map();
  for (const unit of UNITS) {
    const html = await (await fetchWithRetry(`${BASE}/Index.php?Unit=${unit}`)).text();
    const unitName = htmlText(html.match(/<option value="\d+" selected>([\s\S]*?)<\/option>/)?.[1] ?? '');
    const termText = htmlText(html.match(/class="SubTitle02"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? '');
    const periodText = htmlText(html.match(/開課期間[\s\S]{0,120}?<\/div>/)?.[0] ?? '');
    const rows = parseIndex(html, unit, unitName, termText, periodText);
    for (const r of rows) if (!listed.has(r.courseId)) listed.set(r.courseId, r);
    process.stderr.write(`[nantou-cc-portal] Unit=${unit} ${rows.length} 門（${unitName}）\n`);
    await sleep(DELAY_MS);

    try {
      const imm = await (await fetchWithRetry(`${BASE}/course_immediate.php?Unit=${unit}`)).text();
      for (const [id, v] of parseImmediate(imm)) quota.set(id, v);
    } catch (err) {
      process.stderr.write(`[nantou-cc-portal] Unit=${unit} 即時選課失敗：${err.message}\n`);
    }
    await sleep(DELAY_MS);
  }

  const out = [];
  for (const [courseId, row] of listed) {
    let detail = {};
    try {
      const html = await (await fetchWithRetry(`${BASE}/Detail.php?ID=${courseId}`)).text();
      detail = parseDetail(html);
    } catch (err) {
      process.stderr.write(`[nantou-cc-portal] Detail ID=${courseId} 失敗：${err.message}\n`);
    }
    out.push({
      ...row,
      ...detail,
      ...(quota.get(courseId) ?? {}),
      url: `${BASE}/Detail.php?ID=${courseId}`,
    });
    await sleep(DELAY_MS);
  }
  process.stderr.write(`[nantou-cc-portal] 合計 ${out.length} 門，其中 ${quota.size} 門有即時名額\n`);
  return out;
}

await runAsScript(import.meta.url, meta, fetchRaw);
