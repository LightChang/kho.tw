// ingest/sources/forest-nature-edu.mjs
// 農業部林業及自然保育署「自然教育中心課程」（data.gov.tw dataset 70984）。
// 全台自然教育中心的對外課程／活動一覽，實測 124 筆、7 個中心
// （奧萬大、八仙山、池南、東眼山、知本、羅東、雙流）。
// 欄位只有中心名稱、課程類型、課程名稱、開放報名日、報名截止規則與課程網址——
// 細節（費用、時數、名額）要進 url 那頁才有，這一層不去展開（CONTRACT：只取原始資料）。
//
// 端點：dataset 70984 只掛一組資源，三種格式共用同一個 UnitId=D48（＝林業及自然保育署），
// 不是分頁參數，換別的 UnitId 不是這個資料集的範圍——
//   CSV https://data.moa.gov.tw/Service/OpenData/ForestNcLesson.aspx?FOTT=CSV&IsTransData=1&UnitId=D48（本檔用）
//   XML 同網址 FOTT=Xml；JSON 同網址省略 FOTT
// 取 CSV：欄位名是英文、沒有巢狀結構，parseCsvRows 直接吃。
// 回應的 Content-Type 是 application/octet-stream，但內容是帶 BOM 的 UTF-8 CSV，
// csvToObjects 會處理 BOM。
//
// 憑證：實測 Node v22 原生 fetch 可直接建立 TLS 連線，不需要任何額外處理。
// robots.txt：data.moa.gov.tw 的 robots.txt 是空的（沒有任何 Disallow）。
import { fetchWithRetry, csvToObjects, runAsScript } from './_util.mjs';

const CSV = 'https://data.moa.gov.tw/Service/OpenData/ForestNcLesson.aspx'
  + '?FOTT=CSV&IsTransData=1&UnitId=D48';

export const meta = {
  id: 'forest-nature-edu',
  name: '林業保育署自然教育中心課程',
  org: '農業部林業及自然保育署',
  homepage: 'https://data.gov.tw/dataset/70984',
  license: '政府資料開放授權條款-第1版（data.gov.tw dataset 70984 授權方式欄位）',
  updateFreq: '不定期更新（data.gov.tw dataset 70984 更新頻率欄位）',
  format: 'csv',
  entity: 'course',
  // cadence：選 opendata-monthly。
  // 整批 CSV 下載，沒有名額也沒有報名狀態（onAskEnd 是「活動30天前」這種規則字串，
  // 不是即時狀態），所以 course-live 的 3–24h 沒有正當性；
  // 也不是開課後才補登的歷史層，course-archive 不適用。官方宣告「不定期更新」，
  // 用 opendata-monthly 的 3 天起跳、1–7 天區間，由 scheduler 依內容有沒有變自行調整。
  cadence: { kind: 'opendata-monthly' },
  endpoints: [CSV],
  recordCount: 124, // 實測 2026-09-13（與 probe 2026-09-11 的 124 相同）
  verifiedAt: '2026-09-13',
};

// 回傳原始資料陣列，不改欄位名、不轉型。
// 欄位：AduName（自然教育中心名稱）／NAduType（課程類型代碼）／NAduName（課程名稱）／
// onAskStartDay（開放報名日）／onAskEnd（報名截止規則）／url（課程頁）
export async function fetchRaw() {
  const text = await (await fetchWithRetry(CSV)).text();
  return csvToObjects(text);
}

await runAsScript(import.meta.url, meta, fetchRaw);
