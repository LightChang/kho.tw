// ingest/sources/mol-6614.mjs
// 勞動部勞動力發展署「所屬分署自辦在職訓練課程資訊」（data.gov.tw dataset 6614）。
// 在職者的週末／夜間短期班（室內配線、自來水管配管那類），由六個分署自辦，
// 一筆一期別；內容與 taiwanjobs SourceType=2（分署自辦在職訓練）重疊，
// 但這支有官方授權與固定欄位，拿來校正 taiwanjobs 的抓取結果。
//
// 端點：dataset 6614 同一份資料有三種格式，欄位與筆數相同——
//   CSV  https://apiservice.mol.gov.tw/OdService/download/A17000000J-020009-A8I（本檔用，
//        也是 probe/sources.tsv 登記的那一支）
//   XML  https://apiservice.mol.gov.tw/OdService/download/A17000000J-020009-GGN
//   JSON https://apiservice.mol.gov.tw/OdService/download/A17000000J-020009-ZAc
// CSV 欄位值裡有 "學員負擔：1900;政府負擔：4527" 這種內含分號的字串與跨行的課程內容，
// 一律交給 _util.mjs 的 parseCsvRows 處理（它會處理雙引號欄位與欄位內換行）。
//
// 憑證：實測 Node v22 原生 fetch 可直接建立 TLS 連線，不需要任何額外處理。
import { fetchWithRetry, csvToObjects, runAsScript } from './_util.mjs';

const CSV = 'https://apiservice.mol.gov.tw/OdService/download/A17000000J-020009-A8I';

export const meta = {
  id: 'mol-6614',
  name: '分署自辦在職訓練課程資訊',
  org: '勞動部勞動力發展署',
  homepage: 'https://data.gov.tw/dataset/6614',
  license: '政府資料開放授權條款-第1版（data.gov.tw dataset 6614 授權方式欄位）',
  updateFreq: '每1月（data.gov.tw dataset 6614 更新頻率欄位）',
  format: 'csv',
  entity: 'course',
  // cadence：選 opendata-monthly，也是 CONTRACT §3 表格裡舉的那個例子。
  // 官方宣告每月更新，整批 CSV 下載，沒有名額或報名狀態欄位可看（只有報名起訖日），
  // 所以不必用 course-live 的 3–24h 去打它；3 天抓一次、依內容變動在 1–7 天間調整就夠。
  cadence: { kind: 'opendata-monthly' },
  endpoints: [CSV],
  recordCount: 118, // 實測 2026-09-13（與 probe 2026-09-11 的 118 相同；CSV 原始行數 124 行是
  // 因為「課程內容」欄位裡有換行，解析後才是 118 筆——不要拿 wc -l 當筆數）
  verifiedAt: '2026-09-13',
};

// 回傳原始資料陣列，不改欄位名、不轉型。
// 欄位：辦理單位／開訓日期／結訓日期／訓練時段／訓練時數／訓練地點／報名開始日／報名結束日／
// 甄試日期／負擔費用／課程名稱／期別／課程代碼／課程內容
export async function fetchRaw() {
  const text = await (await fetchWithRetry(CSV)).text();
  return csvToObjects(text);
}

await runAsScript(import.meta.url, meta, fetchRaw);
