// ingest/sources/xuanen-centers.mjs
// 軒恩（xuanen）線上報名系統的運動中心課表。救國團、舞動陽光、新北多館、士林 YMCA
// 用的是同一套系統，URL 形狀都是 <站>.aspx?Module=class_booking&files=class_info。
// 一支解析器接 37 個站點，課表是伺服器端 HTML，含滿班人數與可報名人數，不必解析 PDF 簡章。
//
// 課程類別 B 參數不帶時只回第一個類別，所以要逐類別掃。類別代碼取自頁面 rbn_2 的 radio value。
import { fetchWithRetry, htmlText, runAsScript } from './_util.mjs';

const CATEGORIES = [2, 4, 3, 5, 9, 7, 13, 14, 17, 10];

// 站點清單：實測 2026-09-11 有課程的站。名稱後續要在 defaultVenue 逐筆補座標。
export const SITES = [
  ...[1, 9, 10, 11, 12, 13, 15, 16, 17, 18, 20, 25, 26].map((n) => ({
    site: `cyc-tp${String(n).padStart(2, '0')}`,
    url: `https://scr.cyc.org.tw/tp${String(n).padStart(2, '0')}.aspx`,
    operator: '救國團',
  })),
  ...[2, 4, 8, 14, 16, 22, 25, 26, 27, 28, 30, 31, 32, 33, 34, 36, 37].map((n) => ({
    site: `wdyg-wd${String(n).padStart(2, '0')}`,
    url: `https://bwd.xuanen.com.tw/wd${String(n).padStart(2, '0')}.aspx`,
    operator: '舞動陽光',
  })),
  { site: 'fe01', url: 'https://fe.xuanen.com.tw/fe01.aspx', operator: '三重國民運動中心' },
  { site: 'ds02', url: 'https://danson.xuanen.com.tw/ds02.aspx', operator: '宜蘭國民運動中心' },
  { site: 'bq01', url: 'https://bbq.xuanen.com.tw/bq01.aspx', operator: '板橋國民運動中心' },
  { site: 'nt01', url: 'https://bnt.xuanen.com.tw/nt01.aspx', operator: '樹林國民運動中心' },
  { site: 'slsc68', url: 'https://www.ymca.com.tw/slsc68.aspx', operator: '士林運動中心 YMCA' },
];

export const meta = {
  id: 'xuanen-centers',
  name: '軒恩線上報名系統－運動中心課表',
  org: '各運動中心營運商（救國團、舞動陽光等）',
  homepage: 'https://scr.cyc.org.tw/',
  license: 'UNVERIFIED（各營運商網站未標示）',
  updateFreq: 'UNVERIFIED（期別制，每期約兩個月；名額逐日變動）',
  format: 'html',
  entity: 'course',
  cadence: { kind: 'course-live' },
  endpoints: SITES.map((s) => `${s.url}?Module=class_booking&files=class_info`),
  recordCount: 3859, // 實測 2026-09-13：34 站合計（2026-09-11 的 191 只是中山一站，是單站探勘值）
  verifiedAt: '2026-09-13',
};

// 一格課程的文字長相：
// 授課教師：許悅慈 課程名稱：拉丁爵士 課程代碼：A1102 授課教室：2F社區教室
// 2026-07-06~2026-09-14 一 10:00~10:55 滿班人數：22人 可報名人數：10人
function parseCell(text) {
  const get = (label) => {
    const m = text.match(new RegExp(`${label}：\\s*([^ ]+?)(?=\\s|$)`));
    return m ? m[1] : '';
  };
  const range = text.match(/(\d{4}-\d{2}-\d{2})~(\d{4}-\d{2}-\d{2})/);
  const time = text.match(/([一二三四五六日])\s*(\d{1,2}:\d{2})~(\d{1,2}:\d{2})/);
  const full = text.match(/滿班人數：\s*(\d+)/);
  const open = text.match(/可報名人數：\s*(\d+)/);
  const code = get('課程代碼');
  // 查詢表單那格也有「課程代碼：」這個 label（後面接的是欄位說明文字），會被誤抓成課程。
  // 真正的課程代碼是英數，且必定同時有課名與起訖日。
  if (!code || !/^[A-Za-z0-9][A-Za-z0-9_.-]{1,15}$/.test(code)) return null;
  if (!get('課程名稱') || !range) return null;
  return {
    courseCode: code,
    teacher: get('授課教師'),
    courseName: get('課程名稱'),
    classroom: get('授課教室'),
    dateBegin: range?.[1] ?? '',
    dateEnd: range?.[2] ?? '',
    weekday: time?.[1] ?? '',
    timeBegin: time?.[2] ?? '',
    timeEnd: time?.[3] ?? '',
    capacity: full ? Number(full[1]) : null,
    available: open ? Number(open[1]) : null,
    rawText: text,
  };
}

// 匯出供單站測試用：node -e "import('./ingest/sources/xuanen-centers.mjs').then(m => m.fetchSite(m.SITES[0]))"
export async function fetchSite(site) {
  const rows = [];
  for (const category of CATEGORIES) {
    const url = `${site.url}?Module=class_booking&files=class_info`
      + `&A=${encodeURIComponent('全部')}&B=${category}&C=0&D=&E=`;
    let html;
    try {
      html = await (await fetchWithRetry(url)).text();
    } catch (err) {
      process.stderr.write(`[xuanen-centers] ${site.site} B=${category} 失敗：${err.message}\n`);
      continue;
    }
    // 課表是 table，一格一門課；用「課程代碼：」當切點比解 DOM 穩
    for (const cellMatch of html.matchAll(/<td[\s\S]*?<\/td>/gi)) {
      const text = htmlText(cellMatch[0]);
      if (!text.includes('課程代碼：')) continue;
      for (const chunk of text.split(/(?=授課教師：)/)) {
        const row = parseCell(chunk);
        if (row) rows.push({ ...row, _site: site.site, _operator: site.operator, _category: category });
      }
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return rows;
}

export async function fetchRaw() {
  const out = [];
  for (const site of SITES) {
    const rows = await fetchSite(site);
    process.stderr.write(`[xuanen-centers] ${site.site} ${rows.length} 門\n`);
    out.push(...rows);
  }
  // 同一門課可能同時出現在多個類別頁，依站點＋課程代碼去重
  const seen = new Set();
  return out.filter((r) => {
    const k = `${r._site}:${r.courseCode}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

await runAsScript(import.meta.url, meta, fetchRaw);
