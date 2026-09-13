// ingest/sources/sports-venues.mjs
// 教育部體育署「全國運動場館資訊」（data.gov.tw dataset 22849）。
// 這是場館 entity 的主要種子：15,001 列、9,861 個不重複場館，**有經緯度**，
// 其中「國民運動中心」屬性 47 座——正是 xuanen-centers 那些課程的實體場地。
//
// ⚠️ 實測 2026-09-11：官網欄位有失效值（泰山 xwtsc.com 網域過期被轉賣、淡水 tssc.tw 導向
// 垃圾站、蘆洲 lzcsc.cyc.org.tw DNS 查不到），所以不要拿這個欄位當唯一依據。
import { fetchWithRetry, csvToObjects, runAsScript } from './_util.mjs';

const CSV = 'https://ws.sports.gov.tw/FS01/FilePath/1/relfile/164/10269/5a511d68-e6b8-42ee-a449-acc395135268.csv';

export const meta = {
  id: 'sports-venues',
  name: '全國運動場館資訊',
  org: '教育部體育署',
  homepage: 'https://data.gov.tw/dataset/22849',
  license: '政府資料開放授權條款-第1版（data.gov.tw dataset 22849 授權方式欄位）',
  updateFreq: '每1年（data.gov.tw dataset 22849 更新頻率欄位）',
  format: 'csv',
  entity: 'venue',
  cadence: { kind: 'registry' },
  endpoints: [CSV],
  recordCount: 15001, // 實測 2026-09-11
  verifiedAt: '2026-09-11',
};

export async function fetchRaw() {
  const text = await (await fetchWithRetry(CSV)).text();
  return csvToObjects(text);
}

await runAsScript(import.meta.url, meta, fetchRaw);
