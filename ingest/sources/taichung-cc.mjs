// ingest/sources/taichung-cc.mjs
// 臺中市社區大學共學 Full 聯網。前端用 infinite scroll 打 course-search-data，
// 回傳的是 HTML 片段（每頁 10 筆）。這支是本專案少數帶「報名人數／名額」數字的來源。
//
// 期別代碼（semester_state）不是年份規則、是流水號（115 秋 = 383），所以每次先讀
// /courses 的下拉選單，取最新兩個期別，不寫死。
import { fetchWithRetry, htmlText, runAsScript } from './_util.mjs';

const PORTAL = 'https://cc.tc.edu.tw/courses';
const DATA = 'https://cc.tc.edu.tw/application/index/course-search-data';
const MAX_PAGES = 200;

export const meta = {
  id: 'taichung-cc',
  name: '臺中市社區大學共學 Full 聯網－課程查詢',
  org: '臺中市政府教育局',
  homepage: 'https://cc.tc.edu.tw/',
  license: 'UNVERIFIED（站方有著作權聲明，限制商業「轉載重製」；本專案取用的是課程事實資料）',
  updateFreq: 'UNVERIFIED（實測 115 秋季班於開課前即有資料）',
  format: 'html',
  entity: 'course',
  cadence: { kind: 'course-live', boostMonths: [1, 2, 7, 8] },
  endpoints: [`${DATA}?semester_state=383&kind=courseTabList&page=1`],
  recordCount: 1295, // 實測 2026-09-13：115 學年四期合計（2026-09-11 只數了 115 秋的 430）
  verifiedAt: '2026-09-13',
};

// 選單依「年度 + 學期序號」排序，序號是 1春 2秋 3寒 4暑，不是時間順序——
// 直接取最後兩個會拿到 115 寒與 115 暑，不是現在進行中的 115 秋。
// 改成取最新年度的所有期別（至多四個），涵蓋春秋寒暑。
async function latestSemesters() {
  const html = await (await fetchWithRetry(PORTAL)).text();
  const block = html.match(/name="semester_state"[\s\S]*?<\/select>/);
  if (!block) throw new Error('找不到 semester_state 下拉選單');
  const opts = [...block[0].matchAll(/<option[^>]*value="(\d+)"[^>]*>([\s\S]*?)<\/option>/g)]
    .map((m) => ({ value: m[1], label: htmlText(m[2]) }))
    .filter((o) => /\d{3}\s*年度/.test(o.label));
  const years = opts.map((o) => Number(o.label.match(/(\d{3})\s*年度/)[1]));
  const newest = Math.max(...years);
  return opts.filter((o, i) => years[i] === newest);
}

// <tr><td><a class="view-btn" data-id="62014">課名</a></td><td>大屯社大</td>
//   <td>星期五 (早上)</td><td><strong>已開課</strong></td><td><span>0</span> / 30</td>
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
    process.stderr.write(`[taichung-cc] ${semester.label} 累計 ${out.length} 筆\n`);
  }
  const seen = new Set();
  return out.filter((r) => {
    const k = `${r._semester}:${r.courseId}`;
    return !seen.has(k) && seen.add(k);
  });
}

await runAsScript(import.meta.url, meta, fetchRaw);
