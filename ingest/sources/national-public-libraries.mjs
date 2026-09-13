// ingest/sources/national-public-libraries.mjs
// 國立公共資訊圖書館「公共圖書館基本資料」（data.gov.tw dataset 99567）。
// 全國公共圖書館的名稱、地址、電話、**經緯度**與簡介——這是場館名錄，不是課程。
// 回傳結構是「依縣市分組」：頂層 22 個縣市物件，每個底下有 圖書館資訊 陣列。
// 本層不攤平（contract 規定只取得原始資料），所以筆數 = 22 個分組，不是館數；
// 實測 2026-09-13 攤平後共 616 館（臺北 57、新北 104、高雄 64 …）。
// seh.tw 已接同一支 API，該專案也是保留分組結構後交給正規化層攤平。
//
// 只有一支 JSON、單一請求，沒有分頁，因此不需要站內序列間隔。
import { fetchWithRetry, runAsScript } from './_util.mjs';

const ENDPOINT = 'https://plisnet.nlpi.edu.tw/api/API/LibraryInfoData';

export const meta = {
  id: 'national-public-libraries',
  name: '公共圖書館基本資料',
  org: '國立公共資訊圖書館',
  homepage: 'https://data.gov.tw/dataset/99567',
  license: '政府資料開放授權條款-第1版（data.gov.tw dataset 99567 授權方式欄位）',
  updateFreq: '不定期更新（data.gov.tw dataset 99567 更新頻率欄位；各館可自行更新）',
  format: 'json',
  entity: 'venue', // 場館名錄，不進課程分群
  // registry：場館名錄，官方宣告不定期更新，異動只有新館開幕／分館搬遷這種等級（初始 14d／7–30d）。
  cadence: { kind: 'registry' },
  endpoints: [ENDPOINT],
  recordCount: 22, // 實測 2026-09-13：頂層 22 個縣市分組（攤平後 616 館），與 probe「22 縣市分組」相符
  verifiedAt: '2026-09-13',
};

// 回傳原始資料（依縣市分組的陣列），不攤平、不改欄位名
export async function fetchRaw() {
  const res = await fetchWithRetry(ENDPOINT);
  return res.json();
}

await runAsScript(import.meta.url, meta, fetchRaw);
