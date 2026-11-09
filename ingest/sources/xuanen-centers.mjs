// ingest/sources/xuanen-centers.mjs
// 軒恩（xuanen）線上報名系統的運動中心課表。救國團、舞動陽光、新北多館、士林 YMCA
// 用的是同一套系統，URL 形狀都是 <站>.aspx?Module=class_booking&files=class_info。
// 一支解析器接 37 個站點，課表是伺服器端 HTML，含滿班人數與可報名人數，不必解析 PDF 簡章。
//
// 課程類別 B 參數不帶時只回第一個類別，所以要逐類別掃。類別代碼取自頁面 rbn_2 的 radio value。
// **類別代碼是各站自己編的**：中山的 14 是「泳訓團體」，三重的泳池課是 51、53、88。
// 2026-09-28 之前全站共用中山那組 10 個代碼，三重、板橋、樹林、汐止、永和、鳳山的
// 游泳課一門都沒抓到（三重只抓到 31 門）。現在每站先讀自己的 rbn_2 清單再逐類別掃；
// 讀不到清單時才退回 FALLBACK_CATEGORIES。
import { fetchWithRetry, htmlText, runAsScript } from './_util.mjs';

const FALLBACK_CATEGORIES = [2, 4, 3, 5, 9, 7, 13, 14, 17, 10];

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
  // 2026-09-28 補：fe02 竹北、fe03 土城（遠東，頁面「回官網」連結）；
  // tp27 烏日全民運動館（救國團，報名須知頁寫明館名）。
  { site: 'cyc-tp27', url: 'https://scr.cyc.org.tw/tp27.aspx', operator: '救國團' },
  { site: 'fe01', url: 'https://fe.xuanen.com.tw/fe01.aspx', operator: '三重國民運動中心' },
  { site: 'fe02', url: 'https://fe.xuanen.com.tw/fe02.aspx', operator: '遠東' },
  { site: 'fe03', url: 'https://fe.xuanen.com.tw/fe03.aspx', operator: '遠東' },
  { site: 'ds02', url: 'https://danson.xuanen.com.tw/ds02.aspx', operator: '宜蘭國民運動中心' },
  { site: 'bq01', url: 'https://bbq.xuanen.com.tw/bq01.aspx', operator: '板橋國民運動中心' },
  { site: 'nt01', url: 'https://bnt.xuanen.com.tw/nt01.aspx', operator: '樹林國民運動中心' },
  { site: 'slsc68', url: 'https://www.ymca.com.tw/slsc68.aspx', operator: '士林運動中心 YMCA' },
  // 2026-09-29 補：蘆洲國民運動中心（展昭）官網每個課程頁的「如要報名請點此連結」都指到 bcc cc01，
  // 報名須知頁的營業人是「展昭國際企業股份有限公司蘆洲營業所」。同主機 cc02–cc05 回空頁。
  { site: 'bcc-cc01', url: 'https://bcc.xuanen.com.tw/cc01.aspx', operator: '展昭' },
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
  // 實測 2026-09-28：38 站合計 10414（改讀各站類別之前是 3,664；2026-09-13 是 3,859）
  recordCount: 10414,
  verifiedAt: '2026-09-28',
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

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const infoUrl = (site, category) => `${site.url}?Module=class_booking&files=class_info`
  + `&A=${encodeURIComponent('全部')}${category == null ? '' : `&B=${category}`}&C=0&D=&E=`;

// 課表頁的類別 radio：<input id="…rbn_2_0" name="…$rbn_2" value="21"><label for="…rbn_2_0">有氧系列課程</label>
export function parseCategories(html) {
  const labels = new Map(
    [...html.matchAll(/<label for="([^"]*rbn_2_\d+)">([^<]*)</g)].map((m) => [m[1], htmlText(m[2])]),
  );
  const out = [];
  for (const m of html.matchAll(/<input\b[^>]*name="[^"]*\$rbn_2"[^>]*>/g)) {
    const id = m[0].match(/\bid="([^"]+)"/)?.[1];
    const value = m[0].match(/\bvalue="([^"]+)"/)?.[1];
    if (value && /^\d+$/.test(value)) out.push({ code: Number(value), name: labels.get(id) ?? '' });
  }
  return out;
}

function parseCourses(html) {
  const rows = [];
  // 課表是 table，一格一門課；用「課程代碼：」當切點比解 DOM 穩
  for (const cellMatch of html.matchAll(/<td[\s\S]*?<\/td>/gi)) {
    const text = htmlText(cellMatch[0]);
    if (!text.includes('課程代碼：')) continue;
    for (const chunk of text.split(/(?=授課教師：)/)) {
      const row = parseCell(chunk);
      if (row) rows.push(row);
    }
  }
  return rows;
}

// 單站斷路：一個站抓不到時不要把 10 個退回類別逐一再等一輪逾時。
// 2026-10-30 起 cyc-tp01 每次請求都逾時（90 秒 × 3 次），類別清單失敗後再掃 10 個退回類別，
// 一站就吃掉約 45 分鐘，整支 xuanen 從約 18 分拉到 62 分，連帶 run-host 持鎖超過一小時。
//   - 類別清單（站首頁）重試後仍失敗 → 這站本輪放棄（不退回類別）。清單有拿到但解析不到類別才退回。
//   - 類別頁連續失敗 SITE_MAX_CONSECUTIVE_FAILS 次 → 這站本輪放棄，剩下的類別不再打。
// 放棄的站本輪 0 門，跟原本「每個類別都失敗」的結果一樣，只是不再耗時；下輪照常重試。
export const SITE_MAX_CONSECUTIVE_FAILS = 2;

// 匯出供單站測試用：node -e "import('./ingest/sources/xuanen-centers.mjs').then(m => m.fetchSite(m.SITES[0]))"
export async function fetchSite(site) {
  let categories;
  try {
    categories = parseCategories(await (await fetchWithRetry(infoUrl(site, null))).text());
  } catch (err) {
    process.stderr.write(`[xuanen-centers] ${site.site} 類別清單失敗：${err.message}，這站本輪放棄\n`);
    return [];
  }
  if (!categories?.length) categories = FALLBACK_CATEGORIES.map((code) => ({ code, name: '' }));
  const rows = [];
  let consecutiveFails = 0;
  for (const { code, name } of categories) {
    await pause(2000);
    let html;
    try {
      html = await (await fetchWithRetry(infoUrl(site, code))).text();
      consecutiveFails = 0;
    } catch (err) {
      consecutiveFails += 1;
      process.stderr.write(`[xuanen-centers] ${site.site} B=${code} 失敗：${err.message}\n`);
      if (consecutiveFails >= SITE_MAX_CONSECUTIVE_FAILS) {
        process.stderr.write(`[xuanen-centers] ${site.site} 連續 ${consecutiveFails} 個類別失敗，這站本輪放棄\n`);
        break;
      }
      continue;
    }
    for (const row of parseCourses(html)) {
      rows.push({
        ...row, _site: site.site, _url: site.url, _operator: site.operator, _category: code,
        ...(name ? { _categoryName: name } : {}),
      });
    }
  }
  return rows;
}

// 同一台主機的站點依序抓（每次請求間隔 2 秒），不同主機併行。
// 2026-09-28 起每站改掃自己的全部類別（38 站合計約 475 類），全部串行太久，
// 會拖住每小時一次的排程（同一把鎖）；分主機併行後實測 21 分鐘（2026-10 實際約 18 分）。
//
// 整支時間上限 BUDGET_MS（預設 30 分，約正常的 1.7 倍）：超過就不再開新的站。
// 有站因此沒抓到時整支丟錯——scheduler 記這輪失敗、保留上一份 raw、下輪再抓，
// 不拿缺了幾站的結果覆蓋（缺的站的課會被當成消失）。正在抓的站不會被中斷。
export const BUDGET_MS = Number(process.env.KHO_XUANEN_BUDGET_MIN || 30) * 60_000;

export async function fetchRaw({ sites = SITES, budgetMs = BUDGET_MS } = {}) {
  const deadlineAt = Date.now() + budgetMs;
  const byHost = new Map();
  for (const site of sites) {
    const host = new URL(site.url).host;
    if (!byHost.has(host)) byHost.set(host, []);
    byHost.get(host).push(site);
  }
  const perSite = new Map();
  const overBudget = [];
  await Promise.all([...byHost.values()].map(async (hostSites) => {
    for (const site of hostSites) {
      if (Date.now() >= deadlineAt) { overBudget.push(site.site); continue; }
      const rows = await fetchSite(site);
      process.stderr.write(`[xuanen-centers] ${site.site} ${rows.length} 門\n`);
      perSite.set(site.site, rows);
    }
  }));
  if (overBudget.length) {
    throw new Error(`超過 ${+(budgetMs / 60_000).toFixed(2)} 分上限，${overBudget.length} 站沒抓：${overBudget.join(', ')}（保留上一份，下輪再抓）`);
  }
  // 輸出順序固定依 SITES，不受併行完成先後影響（raw 的雜湊決定排程判斷「有沒有變」）
  const out = sites.flatMap((s) => perSite.get(s.site) ?? []);
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
