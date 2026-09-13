// transform/_date.mjs
// 管線用的「今天」一律走台北時區。
//
// 為什麼需要這支：`new Date().toISOString().slice(0, 10)` 取的是 UTC 日曆。
// 台灣是 UTC+8，所以本地時間每天 00:00–08:00 之間跑的資料，日期全都會標成前一天。
// 2026-09-13 早上 07:37 實測：本地 09-13，但 toISOString() 給的是 09-12——
// 當天 normalize 的 lastVerifiedAt、cluster 的 createdAt、首頁的「更新於」
// 與 sitemap 的 lastmod 全部標成 09-12。排程多半在清晨跑，這個時段正是命中區。
//
// 用 'sv-SE' 是因為它的日期格式剛好就是 YYYY-MM-DD，不必自己補零重組。
export const todayTaipei = (d = new Date()) =>
  d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
