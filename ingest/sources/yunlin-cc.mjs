// ingest/sources/yunlin-cc.mjs
// 雲林縣 4 所社區大學（海線／虎尾溪／平原／山線）共用同一套課表系統。
// 站台擺放位置分兩型，AJAX 路徑不同（見 probe/2026-09-13-unresolved.md §1.1）：
//   海線   www.seacoast.url.tw      /SchoolTimetable.php             → /ajax/SchoolTimetable-data.php
//   其餘三校                         /govermentAPI/SchoolTimetable.php → /govermentAPI/SchoolTimetable-data.php
// 後三校的根目錄回 403／404，只有 /govermentAPI/ 底下的頁面活著。
//
// ⚠ `year` 是各校自己的期別流水號，不是年份、四校也不共用：115 秋在海線是 64、
//   虎尾溪 53、平原 53、山線 51。一定要先讀課表頁的 <select name="year"> 再挑，
//   寫死會抓到往年的舊資料。
//
// 回傳的 content-type 標成 text/html，內容其實是 JSON（{state, datalist, …}），
// 一次一期全量、不分頁。四校欄位不齊：place_name／nonpay／label 只有海線有，
// c_now 在平原與山線是數字、海線與虎尾溪是字串——這一層照原樣存，不轉型。
import { fetchWithRetry, postForm, parseJsonLoose, htmlText, runAsScript } from './_util.mjs';

// 校名與主機的對應：四校的課表頁只有海線的 <title> 帶校名，另三校是「課程表」而已。
// 對法是用各站 p_area（上課鄉鎮）比對 ingest/raw/moe-cc-sites.json 的據點鄉鎮，四校完全吻合：
//   favorlangriver 虎尾/土庫/元長/褒忠/東勢 = 虎尾溪；ylpucu 麥寮/西螺/二崙/崙背/台西 = 平原；
//   ylsxcu 斗六/林內/莿桐/斗南/大埤/古坑 = 山線；seacoast 水林/北港/四湖 ⊂ 海線（且 <title> 自證）。
const SCHOOLS = [
  {
    key: 'seacoast',
    name: '雲林縣海線社區大學',
    page: 'https://www.seacoast.url.tw/SchoolTimetable.php',
    data: 'https://www.seacoast.url.tw/ajax/SchoolTimetable-data.php',
    detail: 'https://www.seacoast.url.tw/course.php?',
  },
  {
    key: 'favorlangriver',
    name: '雲林縣虎尾溪社區大學',
    page: 'https://www.favorlangriver.url.tw/govermentAPI/SchoolTimetable.php',
    data: 'https://www.favorlangriver.url.tw/govermentAPI/SchoolTimetable-data.php',
    detail: 'https://www.favorlangriver.url.tw/govermentAPI/course.php?',
  },
  {
    key: 'ylpucu',
    name: '雲林縣平原社區大學',
    page: 'https://ylpucu.url.tw/govermentAPI/SchoolTimetable.php',
    data: 'https://ylpucu.url.tw/govermentAPI/SchoolTimetable-data.php',
    detail: 'https://ylpucu.url.tw/govermentAPI/course.php?',
  },
  {
    key: 'ylsxcu',
    name: '雲林縣山線社區大學',
    page: 'https://www.ylsxcu.url.tw/govermentAPI/SchoolTimetable.php',
    data: 'https://www.ylsxcu.url.tw/govermentAPI/SchoolTimetable-data.php',
    detail: 'https://www.ylsxcu.url.tw/govermentAPI/course.php?',
  },
];

export const meta = {
  id: 'yunlin-cc',
  name: '雲林縣社區大學課程表（海線／虎尾溪／平原／山線）',
  org: '雲林縣政府（四校各自維運站台）',
  homepage: 'https://www.seacoast.url.tw/',
  license: 'UNVERIFIED（四站均未標示；三校根目錄含 robots.txt 回 403／404）',
  updateFreq: 'UNVERIFIED（帶已報名人數與額滿旗標，為即時層）',
  format: 'json',
  entity: 'course',
  cadence: { kind: 'course-live', boostMonths: [1, 2, 7, 8] },
  endpoints: SCHOOLS.map((s) => s.data),
  recordCount: 389, // 實測 2026-09-13（115 秋）：海線 106、虎尾溪 126、平原 84、山線 73
  verifiedAt: '2026-09-13',
};

// 同一個期別，四校寫法都不同：「115年第2學期」「115年第二學期」「115-2秋季」「115年秋季」。
// 為了挑「最新的一期」，把標籤換算成可比較的 (年度, 期序)。期序取上課順序而非選單順序：
// 春季 1 →（暑期 1.5）→ 秋季 2 →（寒假 2.5）。
const CH_NUM = { 一: 1, 二: 2, 三: 3, 四: 4 };

export function rankSemester(label) {
  const text = htmlText(label ?? '');
  const year = Number(text.match(/(\d{3})/)?.[1] ?? 0);
  let term = 0;
  const nth = text.match(/第\s*([1-4一二三四])\s*學期/)?.[1];
  if (nth) term = CH_NUM[nth] ?? Number(nth);
  else if (/-\s*([1-4])/.test(text)) term = Number(text.match(/-\s*([1-4])/)[1]);
  if (/秋/.test(text)) term = 2;
  else if (/春/.test(text)) term = 1;
  else if (/暑/.test(text)) term = 1.5;
  else if (/寒/.test(text)) term = 2.5;
  return { year, term };
}

// 課表頁的 <select name="year">：選單本身是新到舊排列，但不假設這件事，一律照 (年度, 期序) 挑。
async function latestSemester(school) {
  const html = await (await fetchWithRetry(school.page)).text();
  const block = html.match(/<select[^>]*name="year"[\s\S]*?<\/select>/);
  if (!block) throw new Error(`${school.key}：找不到 <select name="year">`);
  const opts = [...block[0].matchAll(/<option[^>]*value="(\d+)"[^>]*>([\s\S]*?)<\/option>/g)]
    .map((m, i) => ({ value: m[1], label: htmlText(m[2]), order: i, ...rankSemester(m[2]) }))
    .filter((o) => o.label);
  if (opts.length === 0) throw new Error(`${school.key}：<select name="year"> 沒有選項`);
  // 年度與期序都相同時，維持選單原順序（第一個）
  return opts.sort((a, b) => b.year - a.year || b.term - a.term || a.order - b.order)[0];
}

export async function fetchRaw() {
  const out = [];
  for (const school of SCHOOLS) {
    const semester = await latestSemester(school);
    await new Promise((r) => setTimeout(r, 1500)); // 同站序列請求，間隔 ≧1s
    const payload = parseJsonLoose(await postForm(school.data, { year: semester.value }));
    const list = Array.isArray(payload) ? payload : (payload.datalist ?? []);
    for (const row of list) {
      out.push({
        ...row, // 原始欄位照抄，不改名、不轉型
        _school: school.key,
        _schoolName: school.name,
        _year: semester.value,
        _yearLabel: semester.label,
        _detailUrl: row.c_sn ? `${school.detail}${row.c_sn}` : '',
      });
    }
    process.stderr.write(
      `[yunlin-cc] ${school.name} year=${semester.value}（${semester.label}）${list.length} 筆，累計 ${out.length}\n`,
    );
    await new Promise((r) => setTimeout(r, 1500));
  }
  // c_sn 只在校內唯一（四校 389 筆裡只有 360 個不重複值），排序與去重都要帶上學校
  const seen = new Set();
  return out
    .filter((r) => {
      const k = `${r._school}:${r.c_sn}`;
      return !seen.has(k) && seen.add(k);
    })
    .sort((a, b) => a._school.localeCompare(b._school)
      || String(a.c_sn).padStart(8, '0').localeCompare(String(b.c_sn).padStart(8, '0')));
}

await runAsScript(import.meta.url, meta, fetchRaw);
