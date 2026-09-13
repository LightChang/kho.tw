// ingest/sources/ntpc-cc.mjs
// 新北市社區大學聯合資訊網－課程查詢。伺服器端 HTML，每頁 10 筆、共 1742 頁（2026-09-12 實測）。
// 列表依開課日期新到舊排序：page 1 是 2026-11、page 500 約 2025-09、page 1742 是 2021-03。
// 所以只抓到 CUTOFF_DAYS 之前就停，不必每次翻 1742 頁（那要 58 分鐘）。
// 要補歷史時跑一次 `node ingest/sources/ntpc-cc.mjs --all`。
//
// 列表沒有費用、上課時刻與名額，那些在 detail（index.php?code=list&ids=25&class_id=N），
// 一課一次請求、共一萬多課，不值得每輪都抓；L1 就先只帶列表層欄位。
import { fetchWithRetry, htmlText, runAsScript } from './_util.mjs';

const BASE = 'https://cci.ntpc.edu.tw/cht/index.php?code=list&ids=15';
const CUTOFF_DAYS = 180;
const MAX_PAGES = 150;   // 150 頁 × 10 筆 = 1500 課，約 5 分鐘
const ALL_MAX_PAGES = 1800;

export const meta = {
  id: 'ntpc-cc',
  name: '新北市社區大學聯合資訊網－課程查詢',
  org: '新北市政府教育局',
  homepage: 'https://cci.ntpc.edu.tw/',
  license: 'UNVERIFIED（站方未標示）',
  updateFreq: 'UNVERIFIED（實測有 11 月才開課的課程，為即時層）',
  format: 'html',
  entity: 'course',
  cadence: { kind: 'course-live', boostMonths: [1, 2, 7, 8] },
  endpoints: [`${BASE}&page=1`],
  recordCount: 1500, // 每輪抓近 180 天；全站 1742 頁約 17420 筆
  verifiedAt: '2026-09-12',
};

// <tr data-href="index.php?code=list&ids=25&class_id=23114">
//   <td data-th="開課日期">2026-08-31</td> … <td data-th="開課狀況">開課中</td>
// </tr>
function parsePage(html) {
  const rows = [];
  for (const m of html.matchAll(/<tr[^>]*data-href="([^"]*class_id=(\d+))"[^>]*>([\s\S]*?)<\/tr>/g)) {
    const [, href, classId, body] = m;
    const row = { classId, detailPath: href.replace(/&amp;/g, '&') };
    for (const c of body.matchAll(/<td[^>]*data-th="([^"]+)"[^>]*>([\s\S]*?)<\/td>/g)) {
      row[c[1]] = htmlText(c[2]);
    }
    rows.push(row);
  }
  return rows;
}

export async function fetchRaw({ all = process.argv.includes('--all') } = {}) {
  // 門檻要用台北日期：列表的開課日是台灣日曆，用 toISOString()（UTC）比對的話，
  // 本地清晨 0–8 點跑會整整早一天砍掉，而排程正好常在那個時段跑。
  // 這裡不從 transform/ 匯入共用模組——取得層不依賴轉換層（見 ingest/CONTRACT.md）。
  const cutoff = new Date(Date.now() - CUTOFF_DAYS * 86400_000)
    .toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
  const maxPages = all ? ALL_MAX_PAGES : MAX_PAGES;
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const html = await (await fetchWithRetry(`${BASE}&page=${page}`)).text();
    const rows = parsePage(html);
    if (rows.length === 0) break;
    out.push(...rows);
    const oldest = rows.map((r) => r['開課日期']).filter(Boolean).sort()[0];
    if (!all && oldest && oldest < cutoff) {
      process.stderr.write(`[ntpc-cc] 第 ${page} 頁已到 ${oldest}（早於 ${cutoff}），停止\n`);
      break;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  // 同一課可能因分頁邊界重複出現
  const seen = new Set();
  return out.filter((r) => !seen.has(r.classId) && seen.add(r.classId));
}

await runAsScript(import.meta.url, meta, fetchRaw);
