# 資料取得層 contract

Node v22.17（原生 fetch，ESM）。每個資料源一支 `.mjs`，放 `ingest/sources/`。
沿用 seh.tw 的 contract，差別只有 §3 的 `cadence`——課程來源的更新節奏和文化活動不同。

這一層**只負責取得原始資料**，不做正規化、不做欄位改名、不做去重。

## 1. 檔案格式

```js
// ingest/sources/<source-id>.mjs
export const meta = {
  id: 'taipei-cc',                     // kebab-case，全域唯一，對應 probe/sources.tsv 的 id
  name: '臺北市社區大學聯網',
  org: '臺北市政府教育局',
  homepage: 'https://lle.tp.edu.tw/',  // 排程依這個網域分組，同網域序列執行
  license: '',                         // 查到的授權，查不到寫 'UNVERIFIED'
  updateFreq: '',                      // 官方宣稱的更新頻率，查不到寫 'UNVERIFIED'
  format: 'json',                      // json | xml | csv | html
  entity: 'course',                    // course | venue | organization
  cadence: { kind: 'course-live' },    // 見 §3
  endpoints: ['https://lle.tp.edu.tw/api/course?limit=5000&page=1'],
  recordCount: 6045,                   // 實測筆數
  verifiedAt: '2026-09-11',
};

// 回傳原始資料陣列，不改欄位名、不轉型
export async function fetchRaw() { /* ... */ }

// 收尾固定這樣寫，三個參數，第一個是 import.meta.url
await runAsScript(import.meta.url, meta, fetchRaw);
```

`entity` 是這裡**唯一**的實體欄位，不要另外加 `entityKind`——那是 normalize 那層的東西
（`transform/normalize/<id>.mjs` 的 `export const entityKind`），兩邊各寫各的。
2026-09-13 一次接七支來源時兩個欄位都寫了，後來確認沒有任何程式讀 ingest 的 `entityKind`，已清掉。

`runAsScript` 少傳 `import.meta.url` 的話，判斷「是否以 CLI 執行」的條件永遠不成立，
指令跑起來沒有任何輸出也沒有錯誤，很難看出哪裡不對。

CLI 可執行：`node ingest/sources/<id>.mjs` → 寫 `ingest/raw/<id>.json`，stderr 印筆數。

## 2. 規則

- 逾時 90s，失敗重試 2 次（指數退避），User-Agent 寫 `kho.tw-ingest/0.1 (+https://kho.tw)`。
- 尊重 robots.txt。需要 API key 的來源不要硬闖。
- 禁止爬需要登入、需繞過防護、或條款禁止的來源。遇到就記錄「不可用 ＋ 原因」到 `probe/sources.tsv`，不要寫 script。已知兩例：教育部樂齡學習網課程查詢（導向登入頁）、17fit（rate-limit 等待頁）。
- 分頁要抓完，不要只抓第一頁。
- **接一支來源 ＝ ingest ＋ normalize 都要做完**。只寫 `ingest/sources/<id>.mjs` 的話，
  `transform/normalize.mjs` 找不到對應的 `transform/normalize/<id>.mjs` 就會印「還沒有 normalize 程式，跳過」，
  資料停在 `ingest/raw/`，進不了 L1、上不了網站，而且整條管線不會報錯。
  2026-09-13 一次接七支來源，就是這樣讓七支資料在原始層躺了一輪才被發現。

## 3. `cadence`：課程來源的節奏分類

seh.tw 用「宣告值 × 活動／名錄」二維交叉。課程這題多一個變數：**名額會變、期別會換**，兩者的節奏差三個數量級。所以改用四類，實際間隔仍由 `transform/scheduler.mjs` 依內容有沒有變自行調整。

| kind | 意義 | 初始 | min | max | 例 |
|---|---|---|---|---|---|
| `course-live` | 即時課程，有名額或報名狀態 | 6h | 3h | 24h | taipei-cc、ntpc-cc、xuanen-*、taiwanjobs |
| `course-archive` | 開課後才補登的歷史層 | 7d | 3d | 14d | moe-cc-courses |
| `registry` | 場館、單位名錄 | 14d | 7d | 30d | sports-venues、moe-senior-centers |
| `opendata-monthly` | 官方宣告每月更新的開放資料 | 3d | 1d | 7d | mol-6614 |

`course-live` 的 min 是 3h，不是 1h：名額變動雖快，但這些站都是各單位自建的小型系統，沒有 CDN，抓太勤沒有正當性。

### 報名季加速

社大與運動中心的報名集中在開課前一到兩個月，其餘時間幾乎不動。`cadence.boostMonths` 列出該來源的報名月份（1–12），排程在這些月份把 min 與初始間隔減半：

```js
cadence: { kind: 'course-live', boostMonths: [1, 2, 7, 8] }
```

社大春季班報名在 1–2 月、秋季班在 7–8 月；運動中心期別每兩個月換一次，不設 boost（它本來就是 6h）。

## 4. 場館自營來源：`defaultVenue`

軒恩報名系統那類「一個站點＝一座場館」的來源，課表裡只有教室名（`2F有氧教室`），沒有地址。這種來源的 `meta` 要宣告 `defaultVenue`，正規化時據此補場館、座標與行政區：

```js
defaultVenue: {
  name: '臺北市中山運動中心',
  lat: 25.0548, lng: 121.5192,          // 來源：data.taipei 121203「臺北市各區運動中心」
  city: '臺北市', district: '中山區',
  address: '臺北市中山區中山北路二段44巷2號',
  hallField: 'classroom',                // 來源的哪個欄位是教室名
},
```

座標一律查證，不得推測。運動中心優先用 data.taipei 121203，其次才是開放資料「全國運動場館資訊」；兩者都沒有的場館填 `lat: null, lng: null, latLngUnverified: true`，並在註解寫查過哪些地方。**開放資料的官網欄位已知有失效值**（泰山、淡水、蘆洲），不要拿它當唯一依據。

**兩份名錄的座標不一致，以 121203 為準。** 2026-09-13 比對臺北市 12 座運動中心，8 座在兩份名錄裡的地址字串完全相同，座標卻差 146–253 公尺：Δ緯度平均 10m（標準差 19m，等於雜訊）、Δ經度平均 **+209m**（標準差 37m），八座方位全落在 78–96°。同一個門牌不可能差 200 公尺，而且偏移方向一致，是全國運動場館資訊在這批資料上的系統性東偏，不是隨機誤差。

## 5. 名額欄位：`capacity` 與 `available`

`enrollment.capacity` 是總名額、`enrollment.available` 是**剩餘**名額。本站首頁的「快額滿」完全靠 `available` 排序，而剩餘名額是全台少數只有這裡看得到的資訊——**填錯就是假的倒數**。

規則只有一條：**分不清楚就不要填**。來源沒有剩餘名額卻硬用其他欄位湊，比留白糟得多。

已知的兩個陷阱：

- `mol-6060`（職業訓練課程資訊）的「數量」欄位**不是招訓人數，是期別序號**。值域只有 1–8、467 筆裡 213 筆是 1（900 小時的班不可能只收 1 人），與 taiwanjobs 重疊的 64 筆對上對方課名裡的「第 NN 期」64/64 完全相同。它進 `term`，不進 `enrollment`。
- `taipei-senior-points`（臺北市銀髮族據點課程）的「人數」是收容上限，沒有任何報名資訊，所以只填 `capacity`、不填 `available`，狀態一律 `unknown`。用上課結束日推「已截止」是拿上課期間冒充報名期間，不可以。
