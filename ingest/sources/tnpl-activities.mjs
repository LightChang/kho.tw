// ingest/sources/tnpl-activities.mjs
// 臺南市立圖書館「活動報名資訊 API」——館方自己公開的 API，不是爬蟲。
// 說明頁：https://www.tnpl.tn.edu.tw/u5045404612791335735/a1（本館資訊API服務／活動報名資訊API）
//
// 端點一次回全部主活動，沒有分頁參數，所以只發一次請求。
// 說明頁另有 pav（館別）、evtKw／sesKw（關鍵字）、sesRegStart／sesRegEnd、sesStart／sesEnd
// 六個篩選參數，全部是「縮小範圍」用的；不帶參數就是全量，這裡就用全量。
//
// 結構是兩層：頂層是「主活動」，每個主活動底下有 `本活動內各場次資訊` 陣列。
// 本層照 contract 只取得原始資料，不攤平、不改欄位名——攤平成一場次一筆是 normalize 的事。
// 實測 2026-09-13：49 個主活動、攤平後 89 個場次，涵蓋 18 個館（總館 23、其餘分館各 1–4）。
//
// ⚠ 名額語意（CONTRACT §5，已查證）：場次欄位 `可報名數` 是**總名額**，不是剩餘名額。
// 證據：主活動 za4976375043056165457 的場次 API 回 `可報名數: "20"`，
// 同一場次的活動頁寫「報名人數 正取人數： 5 / 20」——20 是分母（總額），5 是已報名。
// 另外 89 個場次裡沒有任何一筆是 0、`報名狀態` 也從未出現「額滿」，
// 若是剩餘名額不可能全都非零。所以 normalize 只填 capacity，**不填 available**。
// 來源沒有給「已報名人數」，剩餘名額算不出來，照 §5「分不清楚就不要填」留白。
//
// 憑證：實測 Node v22 原生 fetch 可直接建立 TLS 連線，不需要任何額外處理。
// robots.txt：https://www.tnpl.tn.edu.tw/robots.txt 回的是網站首頁 HTML（沒有 robots 檔），
// 且這是館方公告的公開 API，單次 GET，沒有爬取行為。
import { fetchWithRetry, parseJsonLoose, runAsScript } from './_util.mjs';

const ENDPOINT = 'https://www.tnpl.tn.edu.tw/api/ActivityList.ashx';

export const meta = {
  id: 'tnpl-activities',
  name: '臺南市立圖書館－活動報名',
  org: '臺南市立圖書館',
  homepage: 'https://www.tnpl.tn.edu.tw/',
  license: 'UNVERIFIED（館方 API 說明頁未標示授權；未見於 data.gov.tw）',
  updateFreq: 'UNVERIFIED（報名系統，隨各館上架活動即時變動）',
  format: 'json',
  entity: 'course',
  // 有報名狀態與報名起訖，屬即時層。圖書館活動是單場報名、沒有「報名季」，不設 boostMonths。
  cadence: { kind: 'course-live' },
  endpoints: [ENDPOINT],
  recordCount: 49, // 實測 2026-09-13：49 個主活動（攤平後 89 場次）
  verifiedAt: '2026-09-13',
};

// 回傳原始資料陣列（主活動為單位，保留巢狀場次），不改欄位名、不轉型。
// 回應的 content-type 標成 text/plain，res.json() 不保證可用，所以走文字再 parse；
// parseJsonLoose 會順手處理 BOM 與前置空白。
export async function fetchRaw() {
  const res = await fetchWithRetry(ENDPOINT);
  const records = parseJsonLoose(await res.text());
  if (!Array.isArray(records)) throw new Error('端點回傳的不是陣列，格式可能已改');
  const sessions = records.reduce((n, r) => n + (r?.['本活動內各場次資訊']?.length ?? 0), 0);
  process.stderr.write(`[tnpl-activities] 主活動 ${records.length} 個、場次 ${sessions} 個\n`);
  return records;
}

await runAsScript(import.meta.url, meta, fetchRaw);
