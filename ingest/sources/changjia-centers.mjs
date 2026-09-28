// ingest/sources/changjia-centers.mjs
// 長佳機電營運的運動中心「長佳智慧運動中心」Web App（changjia.sporetrofit.com，軟體商 sporetrofit）。
// 新北市新店國民運動中心的官網只放圖片簡章，課表只在這個 Web App 裡；同一個 App 也管桃園市蘆竹國民運動中心。
//
// 取法（2026-09-28 實測，免登入）：
//   GET  /                                      首頁的隱藏表單列出各館 LID、館名、地址
//   POST /Location/            LID=<館>          場館頁，列出課程類別（CourseList/?LID=…&CategoryID=CCC_CJ_…）
//   POST /Location/CourseList/ajax/createTable/  一個類別的課程清單（伺服器端 HTML 片段）
//        count=500 一次取完；不帶 count 時一頁 8 門，靠 index 往下捲
//   同一支帶 redirectFromFilter=true&weekDay=<0–6>&CategoryID= 是前端的「依星期篩選」，
//        用它反查每門課是星期幾（0＝日）。實測新店 92 門，七個星期的結果合計正好 92。
//
// 清單每門課有：課名、場地、教練、「報名狀況: (已報名/名額)」、價格。
// 課程詳情（起訖日、每堂日期）要打 /api/getRequestData.php，那支會檢查請求來源（Origin），
// 從外部呼叫回「Invalid request origin」——那是刻意的防護，依 CONTRACT §2 不繞過，所以沒有起訖日。
// 期別與開始時刻都寫在課名裡（「115_05兒童週六假日班15:00A」＝115 年第 5 期、15:00），normalize 從課名取。
//
// 名額的分子是「已報名」不是「剩餘」（CONTRACT §5 查證）：
//   1. 同一系統的課程詳情頁，報名人數的寫法是 `報名${CurrentEnterNumber}/${EnterNumber}人`（已報名在前，見頁面 js）；
//   2. 新店 92 門裡分子等於分母的 61 門、分子為 0 的 0 門。清單只列還能插班報名的課（開課第四堂前），
//      若分子是剩餘名額，等於三分之二的課一個人都沒報、卻沒有任何一門額滿，不合理。
// 清單只列還能報名（含插班）的課，已過插班期限的課不會出現，所以本來源不會有「已結束」的課。
//
// robots.txt 回 403（沒有可讀的 robots 檔）。每次請求間隔 2 秒。
import { fetchWithRetry, htmlText, runAsScript } from './_util.mjs';

const BASE = 'https://changjia.sporetrofit.com';

export const meta = {
  id: 'changjia-centers',
  name: '長佳智慧運動中心 Web App－運動中心課程',
  org: '長佳機電工程（營運新北市新店、桃園市蘆竹國民運動中心）',
  homepage: 'https://changjia.sporetrofit.com/',
  license: 'UNVERIFIED（網站未標示）',
  updateFreq: 'UNVERIFIED（期別制，每期約兩個月；報名人數即時變動）',
  format: 'html',
  entity: 'course',
  cadence: { kind: 'course-live' },
  endpoints: [`${BASE}/Location/CourseList/ajax/createTable/`],
  recordCount: 92, // 實測 2026-09-28：新店 92 門（蘆竹另計）
  verifiedAt: '2026-09-28',
};

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const form = (fields) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields).toString(),
});
const text = async (url, options) => (await fetchWithRetry(url, options)).text();

// 首頁：<form id='XDSCForm' action='Location/'><input name='LID' value='XDSC'><input name='LIDName' …><input name='address' …>
export function parseSites(html) {
  const out = [];
  for (const m of html.matchAll(/<form id='([A-Z]+)Form' action='Location\/'[\s\S]*?<\/form>/g)) {
    const val = (name) => m[0].match(new RegExp(`name='${name}' value='([^']*)'`))?.[1] ?? '';
    if (val('LID')) out.push({ lid: val('LID'), name: htmlText(val('LIDName')), address: htmlText(val('address')) });
  }
  return out;
}

// 場館頁：<a class="course-link" href="./CourseList/?LID=XDSC&CategoryID=CCC_CJ_SWIMMING"> … <p>游泳</p>
export function parseCategories(html) {
  return [...html.matchAll(/href="\.\/CourseList\/\?LID=[A-Z]+&CategoryID=(CCC_[A-Z_]+)"[\s\S]*?<p>([^<]*)<\/p>/g)]
    .map((m) => ({ id: m[1], name: htmlText(m[2]) }));
}

// 課程清單片段：一門課一個 listSectionIcon2 區塊，後面跟一個帶 CCID 的隱藏表單
export function parseCourses(html) {
  const out = [];
  for (const block of html.split("<div class='listSectionIcon2'").slice(1)) {
    const ccid = block.match(/CCID=([0-9A-Fa-f-]{36})/)?.[1];
    const labels = [...block.matchAll(/<label>([\s\S]*?)<\/label>/g)].map((m) => htmlText(m[1]));
    if (!ccid || labels.length < 2) continue;
    const statusLabel = labels.find((l) => l.includes('報名狀況')) ?? '';
    const count = statusLabel.match(/\((\d+)\s*\/\s*(\d+)\)/);
    out.push({
      ccid,
      title: labels[0],
      place: labels[1],
      teacher: statusLabel.split('報名狀況')[0].trim(),
      enrolled: count ? Number(count[1]) : null,
      capacity: count ? Number(count[2]) : null,
      priceText: labels.find((l) => /^\$/.test(l)) ?? '',
      image: block.match(/src='([^']+)'/)?.[1] ?? '',
    });
  }
  return out;
}

async function courseTable(site, fields) {
  await pause(2000);
  return parseCourses(await text(`${BASE}/Location/CourseList/ajax/createTable/`, form({
    LID: site.lid, LIDName: site.name, redirectFromSearch: 'false', keyWord: '',
    weekDay: '', index: '', count: '500', ...fields,
  })));
}

export async function fetchRaw() {
  const sites = parseSites(await text(`${BASE}/`));
  if (!sites.length) throw new Error('首頁找不到任何場館表單，版面可能已改');
  const out = [];
  for (const site of sites) {
    await pause(2000);
    const categories = parseCategories(await text(`${BASE}/Location/`, form({ LID: site.lid, LIDName: site.name })));
    const weekdayOf = new Map();
    for (let d = 0; d <= 6; d++) {
      for (const c of await courseTable(site, { CategoryID: '', redirectFromFilter: 'true', weekDay: String(d) })) {
        weekdayOf.set(c.ccid, [...(weekdayOf.get(c.ccid) ?? []), d]);
      }
    }
    const seen = new Set();
    for (const cat of categories) {
      for (const c of await courseTable(site, { CategoryID: cat.id, redirectFromFilter: 'false' })) {
        if (seen.has(c.ccid)) continue;
        seen.add(c.ccid);
        out.push({
          ...c, weekDays: weekdayOf.get(c.ccid) ?? [],
          _lid: site.lid, _site: site.name, _address: site.address,
          _categoryId: cat.id, _categoryName: cat.name,
        });
      }
    }
    process.stderr.write(`[changjia-centers] ${site.name} ${categories.length} 類 ${seen.size} 門\n`);
  }
  return out;
}

await runAsScript(import.meta.url, meta, fetchRaw);
