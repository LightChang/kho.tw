// ingest/sources/ncl-events.mjs
// 國家圖書館「活動報名系統」RSS（data.gov.tw dataset 6838）。
// 成人講座、研習班那類（例：秋季閱讀講座、專題講座），<type> 欄位就是活動類型。
// seh.tw 已接同一支（seh.tw/ingest/sources/ncl-events.mjs），這裡的差別是欄位不寫死、
// cadence 依 kho.tw 的 CONTRACT §3 重新選過。
//
// 來源限制：RSS 只吐最新幾筆（實測上限 10），沒有分頁參數也沒有 offset，
// 抓不到更多是來源如此，不是這支沒抓完。抓到的筆數會隨館方上架／下架浮動
// （2026-09-09 probe 抓到 10 筆，2026-09-13 只有 8 筆）。
//
// 憑證：實測 Node v22 原生 fetch 可直接建立 TLS 連線，不需要任何額外處理。
// robots.txt：web.ncl.edu.tw/robots.txt 回「找不到指定的站台」（沒有 robots），
// 單次 GET 一份公告用 RSS，沒有爬取行為。
import { fetchWithRetry, runAsScript } from './_util.mjs';

const RSS = 'https://web.ncl.edu.tw/event/FMEvents/Rss';

export const meta = {
  id: 'ncl-events',
  name: '國家圖書館 最新活動訊息',
  org: '國家圖書館',
  homepage: 'https://data.gov.tw/dataset/6838',
  license: '政府資料開放授權條款-第1版（data.gov.tw dataset 6838 授權方式欄位）',
  updateFreq: '不定期更新（dataset 6838 更新頻率欄位；RSS 本身即時，但固定只出最新 10 筆）',
  format: 'xml',
  entity: 'course',
  // cadence：選 course-live。
  // 不是因為有名額欄位（這支沒有），而是因為 feed 只留最新 10 筆、又沒有分頁：
  // 抓得比新活動上架的速度慢，中間那幾筆就永遠補不回來。course-live 的 3–24h
  // 是四類裡唯一追得上這種滾動視窗的節奏。
  // 不選 opendata-monthly：那是給整批下載、抓漏了下次還在的檔案用的，這支漏了就沒了。
  cadence: { kind: 'course-live' },
  endpoints: [RSS],
  recordCount: 8, // 實測 2026-09-13（probe 2026-09-11 是 10；來源只出最新 10 筆，會浮動）
  // 場館自營來源（CONTRACT §4）：活動地點就是本館，正規化時據此補場地與行政區。
  defaultVenue: {
    // 地址依 https://www.ncl.edu.tw/ 「聯絡我們」頁；座標在 emap、活動資料、
    // 全國公共圖書館名錄裡都查不到這一館，依 §4 規定填 null 並標記未查證。
    name: '國家圖書館',
    lat: null,
    lng: null,
    latLngUnverified: true,
    city: '臺北市',
    district: '中正區',
    address: '臺北市中正區中山南路20號',
  },
  verifiedAt: '2026-09-13',
};

// <![CDATA[...]]> 去殼＋基本實體還原。這裡只做「把標籤內容原樣取出」，不做正規化。
function decode(raw) {
  return raw
    .replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

// 回傳原始資料陣列，不改欄位名、不轉型。
// 子標籤一律照 feed 原樣當 key（含 a10:updated 這種帶命名空間前綴的），
// 這樣館方哪天多加一個欄位不必改這支；正規化是 transform/normalize.mjs 的事。
// 實測欄位：link／title／description／pubDate／a10:updated／author／site／type／startdate／enddate
export async function fetchRaw() {
  const res = await fetchWithRetry(RSS);
  const xml = new TextDecoder('utf-8').decode(await res.arrayBuffer()).replace(/^﻿/, '');
  const items = xml.match(/<item\b[^>]*>[\s\S]*?<\/item>/g) ?? [];
  return items.map((block) => {
    // 先把 <item> 外殼剝掉，否則子標籤的正規式會先吃到 <item>…</item> 自己
    const inner = block.replace(/^<item\b[^>]*>/, '').replace(/<\/item>$/, '');
    const obj = {};
    const child = /<([A-Za-z_][\w.:-]*)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g;
    let m;
    while ((m = child.exec(inner)) !== null) obj[m[1]] = decode(m[2]);
    return obj;
  });
}

await runAsScript(import.meta.url, meta, fetchRaw);
