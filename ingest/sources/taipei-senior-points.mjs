// ingest/sources/taipei-senior-points.mjs
// 臺北市政府社會局「臺北市銀髮族據點課程資訊」（data.gov.tw dataset 121911／data.taipei CSV）。
// 各銀髮族服務據點的年度課程：課名、開課起訖日、地點（據點名稱）、電話、人數、授課老師。
// 「人數」是該課的收容人數上限，**不是即時可報名名額**，所以不能當報名狀態用。
// 地點欄位只有據點名稱（例：財團法人基督教拿撒勒人會(關渡據點)），沒有地址與座標，
// 要靠正規化層走 geocode 補；本層不處理。
//
// 只有一支 CSV、單一請求，沒有分頁，因此不需要站內序列間隔。
import { fetchWithRetry, csvToObjects, runAsScript } from './_util.mjs';

const CSV = 'https://data.taipei/api/dataset/7566463a-b145-499a-b68c-f6fcb680e5c4'
  + '/resource/62256beb-fbfa-4557-af86-7e03e7fd132c/download';

export const meta = {
  id: 'taipei-senior-points',
  name: '臺北市銀髮族據點課程資訊',
  org: '臺北市政府社會局',
  homepage: 'https://data.gov.tw/dataset/121911',
  license: '政府資料開放授權條款-第1版（data.gov.tw dataset 121911 授權方式欄位）',
  updateFreq: '不定期更新（data.gov.tw dataset 121911 更新頻率欄位）',
  format: 'csv',
  entity: 'course',
  // course-archive：是課程沒錯，但屬「開課後才補登的歷史層」——整份是年度彙整批次
  // （課程期間多為 2025-01-01～2025-12-31 這種整年區間），沒有名額或報名狀態欄位，
  // 官方宣告不定期更新、實際 modifiedDate 為 2025-12-12。所以不用 course-live（6h 太勤、
  // 沒有即時欄位可追），也不用 opendata-monthly（那要求官方宣告每月更新，本資料集不是）。
  // 初始 7d／3–14d 對這種年度批次剛好。
  cadence: { kind: 'course-archive' },
  endpoints: [CSV],
  recordCount: 420, // 實測 2026-09-13（與 probe 實測 420 筆相符）
  verifiedAt: '2026-09-13',
};

// 回傳原始 CSV 列（欄位：課程名稱、開課起始日期、開課結束日期、地點、電話、人數、授課老師）
export async function fetchRaw() {
  const text = await (await fetchWithRetry(CSV)).text();
  return csvToObjects(text);
}

await runAsScript(import.meta.url, meta, fetchRaw);
