// ingest/sources/teamxports-centers.mjs
// 全越運動 XPORTS（teamxports）線上報名系統的期課（多堂課）。全越營運的各館共用一支 Web API，
// 各館網站（sx.teamxports.com 三峽、yg 鶯歌、xy 信義…）都是同一個 Vue 前端打這支 API，
// 所以一支解析器接得到全部場館。新北的三峽、鶯歌國民運動中心只在這裡有課表。
//
// 端點（2026-09-28 實測，免登入、免金鑰；從前端 js 的 src/api/courseEnrollment.js 讀出來）：
//   GET  /api/web/brand/site-list?brandId=1                  → 場館清單（id、名稱、地址、電話）
//   GET  /api/web/brand/site-list-brief?brandId=1&siteId=<任一館>  → 各館網站網域（siteId 給 0 會回「查無資料」）
//   GET  /api/web/courseenrollment/filter-pckg-multiple?brandId=1&siteId=&classDate=  → 該館期課類別
//   POST /api/web/courseenrollment/multiple-course-list  JSON {brandId, siteId, courseCatIds, classDate, memberId}
// 最後一支要 Content-Type: application/json 且 memberId 必須是數字（給 null 會回 400「Incorrect
// Content-Type」），訪客用 0，和前端未登入時送的一樣。
//
// 每筆課有：起訖日、星期、時段、報名起訖、教室、價格、**已報名數、剩餘名額（avaliableCount）、
// 名額上下限**、停課日。剩餘名額＝capacityMax − signedUpCount，實測 578 筆全部相符，語意清楚。
// 報名狀態碼的意思取自前端 getButtonLabel()：1 報名時間未到、2 報名時間已過、3 課程已開始、
// 4 限原班續報，其餘（0）可報名；剩餘名額 0 一律顯示已額滿。
//
// 教師姓名：API 有全名，但前端顯示時刻意遮成「林●皓」。來源自己選擇不公開全名，
// normalize 就不收教師欄位（raw 照原樣保留，不進版控）。
//
// 單堂課（filter-pckg-single）實測各館都是空的，不抓。robots.txt：API 主機回 404（沒有 robots）。
import { fetchWithRetry, runAsScript } from './_util.mjs';

const API = 'https://WEBAPI.Teamxports.com';
const BRAND = 1;

export const meta = {
  id: 'teamxports-centers',
  name: '全越運動 XPORTS 線上報名－運動中心期課',
  org: '全越運動（營運三峽、鶯歌國民運動中心，信義運動中心等）',
  homepage: 'https://WEBAPI.Teamxports.com/',
  license: 'UNVERIFIED（各館網站未標示）',
  updateFreq: 'UNVERIFIED（期別制，每期約兩個月；名額即時變動）',
  format: 'json',
  entity: 'course',
  cadence: { kind: 'course-live' },
  endpoints: [`${API}/api/web/courseenrollment/multiple-course-list`],
  recordCount: 578, // 實測 2026-09-28：8 館合計（信義 277、三峽 85、豐原 81、臺北大學 100…）
  verifiedAt: '2026-09-28',
};

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, options) {
  const body = await (await fetchWithRetry(url, options)).json();
  if (String(body?.returnCode) !== '200') throw new Error(`${url} 回 ${body?.returnCode} ${body?.returnMsg}`);
  return body.data;
}

// 台北時區的今天（YYYY-MM-DD）。classDate 是「列出這天之後還有堂次的期課」的基準日。
const todayTaipei = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

export async function fetchRaw() {
  const detail = await getJson(`${API}/api/web/brand/site-list?brandId=${BRAND}`);
  const info = new Map(detail.map((s) => [s.id, s]));
  await pause(2000);
  const brief = await getJson(`${API}/api/web/brand/site-list-brief?brandId=${BRAND}&siteId=${detail[0]?.id}`);
  const classDate = todayTaipei();
  const out = [];
  for (const site of brief.sites ?? []) {
    await pause(2000);
    const cats = await getJson(`${API}/api/web/courseenrollment/filter-pckg-multiple`
      + `?brandId=${BRAND}&siteId=${site.id}&classDate=${classDate}`) ?? [];
    let n = 0;
    // 逐類別查，才知道每門課屬於哪一類（課程列本身不帶類別）
    for (const cat of cats) {
      await pause(2000);
      const rows = await getJson(`${API}/api/web/courseenrollment/multiple-course-list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandId: BRAND, siteId: site.id, courseCatIds: [cat.id], classDate, memberId: 0 }),
      }) ?? [];
      for (const r of rows) {
        out.push({
          ...r,
          _siteId: site.id,
          _siteTitle: site.title,
          _siteHost: site.url,
          _siteAddress: info.get(site.id)?.address ?? '',
          _categoryId: cat.id,
          _categoryName: cat.typeName,
        });
      }
      n += rows.length;
    }
    process.stderr.write(`[teamxports-centers] ${site.title} ${cats.length} 類 ${n} 門\n`);
  }
  // 同一門課若掛在兩個類別底下，依場館＋課程 id 去重
  const seen = new Set();
  return out.filter((r) => {
    const k = `${r._siteId}:${r.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

await runAsScript(import.meta.url, meta, fetchRaw);
