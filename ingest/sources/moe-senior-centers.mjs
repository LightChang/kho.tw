// ingest/sources/moe-senior-centers.mjs
// 教育部終身教育司「全國樂齡學習中心聯繫資料」（data.gov.tw dataset 163769）。
// 368 所樂齡中心的名稱、承辦單位、電話與地址；沒有座標，要走 geocode 流程補。
// 這是樂齡課程的 provider 名錄——教育部樂齡學習網本身的課程查詢需要登入，不能接（見 CONTRACT §2）。
import { fetchWithRetry, csvToObjects, runAsScript } from './_util.mjs';

const CSV = 'https://ws.moe.edu.tw/Download.ashx?u=LzAwMS9VcGxvYWQvNi9yZWxmaWxlLzc4NTYvOTAxNTAvMzJkZjRlNmUtMDU4OC00YTEwLTg4NDctM2U1NjEwNDg0ODM0LmNzdg%3d%3d'
  + '&n=5YWo5ZyL5qiC6b2h5a2457%2bS5Lit5b%2bD6IGv57mr6LOH5paZLmNzdg%3d%3d&icon=..csv';

export const meta = {
  id: 'moe-senior-centers',
  name: '全國樂齡學習中心聯繫資料',
  org: '教育部終身教育司',
  homepage: 'https://data.gov.tw/dataset/163769',
  license: '政府資料開放授權條款-第1版（data.gov.tw dataset 163769 授權方式欄位）',
  updateFreq: '不定期更新（data.gov.tw dataset 163769 更新頻率欄位）',
  format: 'csv',
  entity: 'organization',
  cadence: { kind: 'registry' },
  endpoints: [CSV],
  recordCount: 368, // 實測 2026-09-11
  verifiedAt: '2026-09-11',
};

export async function fetchRaw() {
  const text = await (await fetchWithRetry(CSV)).text();
  return csvToObjects(text);
}

await runAsScript(import.meta.url, meta, fetchRaw);
