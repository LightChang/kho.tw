// ingest/sources/mol-6060.mjs
// 勞動部勞動力發展署「職業訓練課程資訊」（data.gov.tw dataset 6060）。
// 實測只有分署自辦的職前訓練課程（467 筆），不是 README v0 說的「一年數千筆」；
// 產業人才投資方案那七成六要從 taiwanjobs 那一支抓（見 probe/2026-09-11-sources.md §1.5）。
// 內容與 taiwanjobs SourceType=1 高度重疊，這支的價值在於欄位齊、有官方授權，
// 可以拿來校正 taiwanjobs 的抓取結果。
//
// 端點：dataset 6060 同一份資料有三種格式的下載點，欄位名稱與筆數相同——
//   JSON https://apiservice.mol.gov.tw/OdService/download/A17000000J-000007-eqj（本檔用）
//   XML  https://apiservice.mol.gov.tw/OdService/download/A17000000J-000007-arR
//   CSV  https://apiservice.mol.gov.tw/OdService/download/A17000000J-000007-U3w
// 取 JSON 版：欄位名是中文，JSON 解析不必自己處理標籤跳脫，最不容易失真。
// probe/sources.tsv 登記的端點也是這一支。
//
// 憑證：實測 Node v22 原生 fetch 可直接建立 TLS 連線，不需要任何額外處理。
// robots.txt：apiservice.mol.gov.tw 的 /robots.txt 被前端 WAF 擋掉（Request Rejected），
// 但本站是 data.gov.tw 掛牌的開放資料下載點，單檔單次 GET，沒有爬取行為。
import { fetchWithRetry, parseJsonLoose, runAsScript } from './_util.mjs';

const JSON_URL = 'https://apiservice.mol.gov.tw/OdService/download/A17000000J-000007-eqj';

export const meta = {
  id: 'mol-6060',
  name: '職業訓練課程資訊',
  org: '勞動部勞動力發展署',
  homepage: 'https://data.gov.tw/dataset/6060',
  license: '政府資料開放授權條款-第1版（data.gov.tw dataset 6060 授權方式欄位）',
  updateFreq: '不定期更新（data.gov.tw dataset 6060 更新頻率欄位）',
  format: 'json',
  entity: 'course',
  // cadence：選 opendata-monthly。
  // 不選 course-live 的理由：這是整批下載的開放資料檔，不是報名系統的即時介面。
  // 「數量」欄位不是人數，是期別序號（2026-09-13 實測：值域只有 1–8、467 筆裡 213 筆是 1，
  // 900 小時的班不可能只收 1 人；與 taiwanjobs 重疊的 64 筆，「數量」對上對方課名裡的
  // 「第NN期」64/64 完全相同）。正規化時它進 term，不進 enrollment——當成名額填下去，
  // 首頁「快額滿」就會出現假的倒數。詳見 transform/normalize/mol-6060.mjs 檔頭。
  // 本來源沒有任何名額欄位，所以抓再勤也看不到名額變化；
  // 真的要即時報名狀態要看 taiwanjobs（那支才是 course-live）。
  // 官方宣告是「不定期更新」而非每月，但四類裡只有 opendata-monthly 是給開放資料檔用的，
  // 其 1–7 天區間對「不定期」也夠用；實際間隔由 transform/scheduler.mjs 依內容有沒有變自行調整。
  cadence: { kind: 'opendata-monthly' },
  endpoints: [JSON_URL],
  recordCount: 467, // 實測 2026-09-13（與 probe 2026-09-11 的 467 相同）
  verifiedAt: '2026-09-13',
};

// 回傳原始資料陣列，不改欄位名、不轉型。
// 欄位（中文鍵）：網址／訓練期間／報名期間／甄試日期／經費／訓練目標／課程內容／分署／
// 訓練單位名稱／訓練時段／訓練時數／訓練縣市／訓練區域／郵遞區號前三碼／郵遞區號後三碼／
// 訓練地址／單位名稱／聯絡方式／聯絡手機／聯絡EMAIL／課程編號／課程名稱／數量／哈希直
export async function fetchRaw() {
  const text = await (await fetchWithRetry(JSON_URL)).text();
  const rows = parseJsonLoose(text);
  return Array.isArray(rows) ? rows : [];
}

await runAsScript(import.meta.url, meta, fetchRaw);
