// ingest/sources/taipei-sports-centers.mjs
// 臺北市政府體育局「臺北市各區運動中心」（data.gov.tw dataset 121203／data.taipei CSV）。
// 12 座市民運動中心的名稱、地址、電話、官網與**經緯度**——這是場館名錄，不是課程。
// CONTRACT §4 指定運動中心座標優先用本資料集（121203），xuanen-centers 那些課程的
// defaultVenue 座標即出自這裡；全國運動場館資訊（sports-venues）的官網欄位已知有失效值，
// 不可當唯一依據，北市這 12 座以本檔為準。
//
// 只有一支 CSV、單一請求，沒有分頁，因此不需要站內序列間隔。
import { fetchWithRetry, csvToObjects, runAsScript } from './_util.mjs';

const CSV = 'https://data.taipei/api/dataset/80be7612-593f-4795-9935-a10ce0f7b75b'
  + '/resource/e7c46724-3517-4ce5-844f-5a4404897b7d/download';

export const meta = {
  id: 'taipei-sports-centers',
  name: '臺北市各區運動中心',
  org: '臺北市政府體育局',
  homepage: 'https://data.gov.tw/dataset/121203',
  license: '政府資料開放授權條款-第1版（data.gov.tw dataset 121203 授權方式欄位）',
  updateFreq: '每1年（data.gov.tw dataset 121203 更新頻率欄位）',
  format: 'csv',
  entity: 'venue', // 場館名錄，不進課程分群
  // registry：場館名錄，官方宣告每年更新，內容幾乎不動（初始 14d／7–30d）。
  // 不用 course-live——這裡沒有課程、沒有名額或報名狀態，抓再勤也沒有正當性。
  cadence: { kind: 'registry' },
  endpoints: [CSV],
  recordCount: 12, // 實測 2026-09-13（與 probe 實測 12 筆相符）
  verifiedAt: '2026-09-13',
};

// 回傳原始 CSV 列（欄位：名稱、郵遞區號、地址、電話、網址、經度、緯度），不改欄位名、不轉型
export async function fetchRaw() {
  const text = await (await fetchWithRetry(CSV)).text();
  return csvToObjects(text);
}

await runAsScript(import.meta.url, meta, fetchRaw);
