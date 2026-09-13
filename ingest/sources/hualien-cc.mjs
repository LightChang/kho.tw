// ingest/sources/hualien-cc.mjs
// 花蓮縣社區大學（cloudschool）。和臺中市社大共學 Full 聯網是**同一套廠商系統**：
// 打錯 semester_state 時回的錯誤頁標題直接是「臺中市社區大學社區共學Full聯網」。
// 端點形狀、列表欄位順序與 taichung-cc.mjs 完全相同，所以解析邏輯照抄那支。
//
// 兩點和臺中不一樣：
// 1. semester_state 是各站自己的流水號，不共用（臺中 115 秋是 383，花蓮是 18），
//    一樣先讀 /courses 的下拉選單，不寫死。
// 2. 授課時間那格可能列**多個星期**（例如「星期五 (全天) 星期六 (全天) 星期日 (全天)」），
//    臺中實測都是單一星期。這裡整格原文留著，由 normalize 拆成多個 slot。
import { fetchWithRetry, htmlText, runAsScript } from './_util.mjs';

const PORTAL = 'https://hualien.cloudschool.com.tw/courses';
const DATA = 'https://hualien.cloudschool.com.tw/application/index/course-search-data';
const MAX_PAGES = 200;

export const meta = {
  id: 'hualien-cc',
  name: '花蓮縣社區大學－課程查詢',
  org: '花蓮縣政府（花蓮社區大學）',
  homepage: 'https://hualien.cloudschool.com.tw/',
  license: 'UNVERIFIED（站方未標示；robots.txt 為 Allow: /）',
  updateFreq: 'UNVERIFIED（即時層，列表帶開課狀況與報名人數）',
  format: 'html',
  entity: 'course',
  cadence: { kind: 'course-live', boostMonths: [1, 2, 7, 8] },
  endpoints: [`${DATA}?semester_state=18&kind=courseTabList&page=1`],
  recordCount: 72, // 實測 2026-09-13：115 年度第 2 學期(秋)，page 1–7 各 10 筆、page 8 兩筆
  verifiedAt: '2026-09-13',
};

// 選單依「年度 + 學期序號」排序，序號是 1春 2秋 3寒 4暑，不是時間順序，
// 所以取最新年度的所有期別，不是取最後一個（同 taichung-cc 的處理）。
async function latestSemesters() {
  const html = await (await fetchWithRetry(PORTAL)).text();
  const block = html.match(/name="semester_state"[\s\S]*?<\/select>/);
  if (!block) throw new Error('找不到 semester_state 下拉選單');
  const opts = [...block[0].matchAll(/<option[^>]*value="(\d+)"[^>]*>([\s\S]*?)<\/option>/g)]
    .map((m) => ({ value: m[1], label: htmlText(m[2]) }))
    .filter((o) => /\d{3}\s*年度/.test(o.label));
  if (opts.length === 0) throw new Error('semester_state 選單沒有可用的年度期別');
  const years = opts.map((o) => Number(o.label.match(/(\d{3})\s*年度/)[1]));
  const newest = Math.max(...years);
  return opts.filter((o, i) => years[i] === newest);
}

// <tr><td><a class="view-btn" data-id="3448">課名</a></td><td>花蓮社大</td>
//   <td>星期五 (全天) 星期六 (全天)</td><td>已額滿</td><td><span>20</span> / 20</td>
//   <td>優惠 badge</td><td>課程標籤 badge</td></tr>
function parseRows(html, semester) {
  const rows = [];
  for (const tr of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const body = tr[1];
    const idMatch = body.match(/class="[^"]*view-btn[^"]*"[^>]*data-id="(\d+)"/);
    if (!idMatch) continue;
    const cells = [...body.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => htmlText(c[1]));
    const quota = cells[4]?.match(/(\d+)\s*\/\s*(\d+)/);
    rows.push({
      courseId: idMatch[1],
      courseName: cells[0] ?? '',
      school: cells[1] ?? '',
      timeText: cells[2] ?? '',
      statusText: cells[3] ?? '',
      enrolled: quota ? Number(quota[1]) : null,
      capacity: quota ? Number(quota[2]) : null,
      discountText: cells[5] ?? '',
      tagText: cells[6] ?? '',
      _semester: semester.value,
      _semesterLabel: semester.label,
    });
  }
  return rows;
}

export async function fetchRaw() {
  const semesters = await latestSemesters();
  const out = [];
  for (const semester of semesters) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = `${DATA}?school_id=&subject_edu_id=&course_state=&semester_state=${semester.value}`
        + `&area_state=&kind=courseTabList&page=${page}`;
      const rows = parseRows(await (await fetchWithRetry(url)).text(), semester);
      if (rows.length === 0) break;
      out.push(...rows);
      await new Promise((r) => setTimeout(r, 2000));
    }
    process.stderr.write(`[hualien-cc] ${semester.label} 累計 ${out.length} 筆\n`);
  }
  const seen = new Set();
  return out.filter((r) => {
    const k = `${r._semester}:${r.courseId}`;
    return !seen.has(k) && seen.add(k);
  });
}

await runAsScript(import.meta.url, meta, fetchRaw);
