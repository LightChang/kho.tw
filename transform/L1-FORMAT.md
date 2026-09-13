# L1 格式（normalize 產出）

每支 `transform/normalize/<source-id>.mjs` 讀 `ingest/raw/<source-id>.json`，產出
`data/staged/<source-id>.ndjson`。一筆來源記錄 = 一行 NDJSON。這一層不跨來源合併。

沿用 seh.tw 的 L1 慣例（缺值省略整個 key、不補假精度、`_` 開頭是系統欄位），型別從
Event 換成 **Course**。差別在下面 §2 的三件事：期別、報名生命週期、名額。

---

## 1. Course record

```jsonc
{
  // ── 來源追溯 ──────────────────────────────
  "_source": "taipei-cc",                       // required，對應 meta.id
  "_sourceRecordId": "6a93f0441b66a0228f29c57b", // required
  "_fetchedAt": "2026-09-12T10:00:00+08:00",     // required

  "sourceUrl": "https://tscc3.org/tscc/latestclass/",
  "sourceUpdatedAt": "2026-08-30T16:56:34+08:00",
  "externalIds": { "schoolCourseCode": "1151C9003" },  // 見 §3，跨來源合併的第一錨點

  // ── 內容 ─────────────────────────────────
  "title": "零基礎核心瑜珈",                      // required
  "description": "…",
  "categoryRaw": "生活藝能_運動舞蹈類",            // 原始值；canonical 對照在 L2
  "audienceRaw": "55歲以上",                      // 樂齡／在職／親子／設籍限制的原始寫法
  "topicsRaw": ["美感教育", "傳統藝術"],           // 社大的議題標籤，和 categoryRaw 是兩套
  "teachers": [{ "nameRaw": "趙美玲" }],
  "credit": 1,

  // ── 主辦 ─────────────────────────────────
  "provider": {
    "nameRaw": "臺北市士林社區大學",
    "kind": "community-college",  // community-college|sports-center|senior-center|library|vocational
    "operatorRaw": "救國團",       // 運動中心才有
  },

  // ── 期別與時段 ────────────────────────────
  "term": { "raw": "115年度秋季班", "year": 115, "season": "autumn" },  // 見 §2.1
  "schedule": {
    "startDate": "2026-09-04",          // required
    "endDate": "2026-11-27",
    "recurrence": "weekly",             // weekly|biweekly|twice-weekly|irregular|single
    "sessionsPerWeek": 1,
    "weeks": 12,
    "hours": 96,                        // 總時數；職訓來源才有
    "slots": [                          // 一週上幾次就幾筆
      { "weekday": 5, "startTime": "16:15", "endTime": "19:15" }
    ],
    "timeInfoRaw": "116/1/9、16、23",    // 來源的自由文字補充，不解析
  },

  // ── 報名 ─────────────────────────────────
  "enrollment": {
    "status": "open",                   // open|full|running|closed|cancelled|unknown，見 §2.2
    "statusRaw": "招生中",
    "opensAt": "2026-08-03T09:00:00+08:00",
    "closesAt": "2026-08-07T12:00:00+08:00",
    "capacity": 22,
    "available": 10,                    // 只有軒恩與臺中聯網給得出數字
    "registerUrl": "https://…",
  },

  // ── 費用 ─────────────────────────────────
  "isFree": false,                      // 只在能可靠判定時才有此 key
  "price": 1000,
  "priceText": "個人報名第1班【1-54歲 1500元,55-64歲 600元,65以上歲 0元",

  // ── 地點 ─────────────────────────────────
  "location": {
    "venueNameRaw": "公民教室：承德路四段190號2樓(第6教室)",
    "address": "臺北市士林區承德路四段190號",
    "addressPrecision": "street",       // street|district|city|venue-name-only|none
    "city": "臺北市",
    "district": "士林區",
    "lat": 25.0972,                     // 由 geocode/out/geocoded.csv 帶入
    "lng": 121.5251,
    "geocodeSource": "tgos-batch",      // tgos-batch|registry|source
  }
}
```

**缺值一律省略整個 key**，不用 `null`、不用 `""`。

**`_fetchedAt` 不參與 `contentHash`，也不寫進 observation 的 payload。** 它每跑一次就變，
放進雜湊會讓每次 normalize 都把全部記錄判成「內容有變」，`lastChangedAt` 失去意義、
版控 diff 也會變成全量。observation 那層用 `lastVerifiedAt`（只有日期）表達同一件事。
`data/staged/` 是中間檔、不進版控，所以它保留 `_fetchedAt` 沒有關係。

---

## 2. 和 seh.tw Event 的三個差異

### 2.1 期別，不是單場

課程是「115 年度秋季班」這種一期十幾週，不是單日活動。所以用 `schedule.recurrence` ＋
`slots`，不是 `sessions[]` 一場一筆。各來源的期別寫法不一致，`term.raw` 存原文，
`year`／`season` 是正規化後的值：

| 來源 | 原文 | year | season |
|---|---|---|---|
| moe-cc-courses | `quarter: 1152` | 115 | autumn |
| taipei-cc | `115年度秋季班`、大安／文山／中正寫成 `115年度第2期` | 115 | autumn |
| 社大共用平台 | `115-秋季班` | 115 | autumn |
| taichung-cc | `115 年度 - 第 2 學期 (秋)`（`semester_state=383`） | 115 | autumn |
| xuanen-centers | `11503` | 115 | 第 3 期（運動中心是雙月期別，不用四季） |

季別值域：`spring|autumn|summer|winter`，運動中心另用 `termNo`（1–6）。

### 2.2 報名狀態是統一值域

各來源的原始寫法都不同，`statusRaw` 存原文，`status` 收斂成六個值：

| status | 對應的來源原文 |
|---|---|
| `open` | 招生中、公布、開（社大共用平台）、報名中 |
| `upcoming` | 報名尚未開始（來源給了報名起日，但還沒到）。和 `unknown` 分開，因為「還沒開放」是真實資訊，職訓來源實測 1,403/2,396 屬於這類 |
| `full` | 額滿、滿 |
| `running` | 開課中、已開課、進行中 |
| `closed` | 已截止、報名結束 |
| `cancelled` | 停招、停開、停課中、不足額停開 |
| `unknown` | 來源不回報（例如 moe-cc-courses 的 `teach_status` 實測恆為 1） |

### 2.3 名額是觀測值，不是屬性

`enrollment.available` 每天會變，它屬於 observation 層的變更軌跡，不是課程的固有屬性。
`data/observation/<source>.ndjson` 的 `contentHash` 會因此每天變動——這是預期行為，
不要為了讓 hash 穩定而把名額排除在外，「還有位子的課」就是靠它。

---

## 3. `externalIds`：跨來源合併的錨點

實測（2026-09-11，北市 12 所社大 115 春）：教育部全國站的 `internal_course_code` 與
北市聯網的 `code` 是**同一個值**（`1151C9003`、`261083` 兩邊一致）。所以兩邊都填進
`externalIds.schoolCourseCode`，L2 分群第一條規則就是它，confidence 1.0。

只靠課名比對會誤配：同一所社大同期有同名不同班的課（「紓緩養身瑜珈」C7015 週五、
C7017 週六）。課名規則只當備援，confidence 0.9。

---

## 4. 場館

`location.lat/lng` 不在 ingest 層取得。流程是：normalize 產出 `address` →
`geocode/build_tgos_input.py` 蒐集不重複門牌 → TGOS 批次 →
`geocode/import_tgos_results.py` 回填 `geocode/out/geocoded.csv` → L1 由地址查快取帶入。

查不到座標的照 seh.tw 的懸空邊處理：課程頁照常顯示地點文字，只是不連到場館頁，
並依出現次數進 review queue（`geocode/out/unresolved.csv` 已經是這份清單）。
