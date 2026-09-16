# AEO：讓機器讀得懂答案的監看指標

AEO（Answer Engine Optimization）指的是「讓搜尋結果的答案區塊、語音助理、
複合式搜尋結果能直接取用本站的事實」。對本站來說就是結構化資料與欄位覆蓋率。

**這份文件不寫任何現況數字**，理由與規則見 `docs/SEO.md` 開頭。每一項只寫指令與判讀方式。

## 0. 前置

```bash
export KHO_GOOGLE_KEY_FILE=~/.config/kho-tw/kho-seo-key.json
```

## 1. 本站輸出哪些結構化資料

實作在 `site/jsonld.mjs`，三種型別：

- **Course**：每個課程頁一份，含 `name`、`description`、`provider`、`hasCourseInstance`（時段、地點、講師、報名狀態）
- **ItemList**：清單頁（可報名、類型、主題、縣市、場館、講師）
- **Place**：場館頁，含地址與座標

Google 目前支援的是「Course list（課程輪轉介面）」，要求 `ItemList.itemListElement` 帶
`position` 與 `url`、**且至少三門課**；原本的「Course info」複合式結果已淘汰（2026-09-12 查證）。
其餘屬性照 schema.org 詞彙寫，對複合式結果不加分也不扣分，但對 AI 取用是有用的事實。

現況統計一律用指令取得，不寫在這裡：

```bash
node site/validate-jsonld.mjs        # 檢查了幾頁、其中幾頁有 JSON-LD、各型別各幾份、有沒有問題
```

**本機 `dist/` 可能是 `KHO_LIMIT` 的部分建置**，數字會偏低；要全量請先 `pnpm run site`（見 `docs/SEO.md` §2）。

## 2. 結構化資料的健康檢查

| 指標 | 指令 | 判讀 |
|---|---|---|
| 格式與列舉值 | `node site/validate-jsonld.mjs` | 必須「沒有發現問題」。CI 每輪都跑，失敗會擋下部署 |
| Google 實際偵測到什麼 | `node scripts/google.mjs diagnose <網址>` | 會列出 Google 在該頁偵測到的複合式結果型別與逐項問題 |
| 描述覆蓋率 | 見 `docs/SEO.md` §2 的 node 指令 | `description` 是 Course 的必要屬性。來源沒給時 `describe()` 會用已有事實組一句，不編造內容 |

沒有描述的課程頁仍然會輸出 Course，`describe()` 用開課單位、期別、時段、地點組出一句陳述，
並截到 200 字。要看實際輸出：

```bash
node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { describe } from './site/jsonld.mjs';
const line = readFileSync('data/courses.ndjson', 'utf8').split('\n').find(Boolean);
console.log(describe(JSON.parse(line)));"
```

## 3. 事實正確性比覆蓋率重要

本站的 AEO 價值在於「答案是對的、而且說得出出處」。三條規則寫在程式裡，改動前先讀：

- **不宣稱不確定的事**：`enrollment.status` 是 `running` 或 `unknown` 時不輸出 `availability`
  （`site/jsonld.mjs` 的 `AVAILABILITY`）。寧可不宣告，也不要宣稱一件我們不確定的事。
- **不用上課期間冒充報名期間**：課程結束日過了只會在頁面上寫「課程已於 X 結束」，
  不會把報名狀態改成已截止（`ingest/CONTRACT.md` §5）。
- **推測要標明**：分類是從課名推斷的，頁面與卡片會註明「依課名判斷」，不混進來源事實。

每個課程頁都有「資料來源」區塊，列出各來源、原始連結與最後確認日期。
這是 AI 引擎願意引用的關鍵——可驗證的出處。

檢查某一頁的來源區塊有沒有正常輸出：

```bash
curl -s "https://kho.tw/course/<slug>.html" \
  | perl -0pe 's/<(script|style)\b[^>]*>.*?<\/\1>//gs; s/<[^>]*>/ /g; s/\s+/ /g' \
  | grep -o '資料來源.*' | cut -c1-400
```

（HTML 壓縮成一行，`grep -A5` 會把整頁倒出來，所以先抽成純文字再取那一段。）

`<slug>` 可以從 sitemap 取一個：

```bash
curl -s https://kho.tw/sitemap-courses-1.xml | grep -o '<loc>[^<]*</loc>' | head -3 | sed 's/<[^>]*>//g'
```

## 4. 什麼時候要回頭改結構化資料

- `validate-jsonld` 報錯：**立刻修**，那表示產出的 JSON-LD 不合規格。
- `diagnose` 顯示複合式結果有 ERROR 等級問題：修。WARNING 等級先評估值不值得。
- Google 的規格改版：規格出處都寫在 `site/jsonld.mjs` 檔頭的註解裡，改版時連同註解一起更新，
  不要只改程式——下次有人看到舊註解會以為規格沒變。
