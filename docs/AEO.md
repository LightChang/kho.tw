# AEO：讓機器讀得懂答案的監看指標

> 往哪裡長、下一步做什麼：見 `docs/GROWTH.md`。這份只管監看。

AEO（Answer Engine Optimization）指的是「讓搜尋結果的答案區塊、語音助理、
複合式搜尋結果能直接取用本站的事實」。對本站來說就是結構化資料與欄位覆蓋率。

**這份文件不寫任何現況數字**，理由與規則見 `docs/SEO.md` 開頭。每一項只寫指令與判讀方式。

## 0. 前置

```bash
export KHO_GOOGLE_KEY_FILE=~/.config/kho-tw/kho-seo-key.json
```

## 1. 本站輸出哪些結構化資料

實作集中在 `site/jsonld.mjs`，唯一出口是 `src/components/Head.astro`（`Base.astro` 帶入）；首頁自己呼叫同一個 Head。

| 頁型 | 類型 | Google 現況（`vendor/seo-ops-jsonld/rules.json`） |
|---|---|---|
| 首頁 | Organization＋WebSite（`@graph`） | WebSite 只剩 Site names（name、url）。SearchAction 已移除：sitelinks search box 2024-11 取消 |
| 課程頁 | Course（含 `hasCourseInstance`、`offers`）＋BreadcrumbList | Course list 只支援英文，中文頁不會有強化結果；Course info 2025-09 淘汰。開課資訊屬性哪些失效查不到，保守保留（理由寫在 `courseJsonLd` 註解） |
| 課程清單頁（可報名、縣市、主題、類型、細項、證照班、講師） | ItemList（至少三門、position＋url）＋BreadcrumbList | 同上，照 Course list／Carousel 規格輸出 |
| 索引頁（主題、想學什麼、講師） | ItemList（站內頁面）＋BreadcrumbList | ItemList 裝一般頁面不產生結果，屬 schema.org 描述 |
| 場館頁 | Place＋BreadcrumbList | Place 沒有 Google 功能 |
| 其他入口頁 | BreadcrumbList | 麵包屑：所有地區語言、只在桌機顯示 |

麵包屑的層級定義在 `src/lib/crumbs.mjs`，同一個陣列畫成頁面上的可見麵包屑（`src/components/Breadcrumbs.astro`）
與 BreadcrumbList，兩者不會對不起來。首頁滿版、沒有麵包屑。

現況統計一律用指令取得，不寫在這裡：

```bash
node site/validate-jsonld.mjs        # 檢查了幾頁、其中幾頁有 JSON-LD、各型別各幾份、有沒有問題（含首頁）
```

**本機 `dist/` 可能是 `KHO_LIMIT` 的部分建置**，數字會偏低；要全量請先 `pnpm run site`（見 `docs/SEO.md` §2）。

## 2. 結構化資料的健康檢查

| 指標 | 指令 | 判讀 |
|---|---|---|
| 格式、必填、頁型 | `node site/validate-jsonld.mjs` | 必須「沒有錯誤」。共用規則（`vendor/seo-ops-jsonld`）＋頁型要求（`site/jsonld-pages.json`）＋本站列舉值檢查。`pnpm run build` 與 `ops/run-host.sh` 每輪都跑，失敗就不部署 |
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
- Google 的規格改版：走下一節的複查，不要在本站直接改規則。

## 5. 規則出處與每季複查

規則不在本站自己判斷，一律以四站共用的查證結果為準：

- 查證紀錄（每條附官方來源與查證日）：`/mnt/yao-care/seo-ops/jsonld/README.md` 的「查證紀錄」、`rules.json`
- 本站用的是 vendor 副本 `vendor/seo-ops-jsonld/`，來源 commit 與同步指令寫在該目錄的 README
- 本站頁型要求：`site/jsonld-pages.json`，每條附依據

每季一次（或 Search Central 更新紀錄出現結構化資料相關項目時）：

1. 確認上游 seo-ops 已照它 README 的「重做查證」六步驟更新過 `rules.json`（查證紀錄會多一列新日期）；還沒就先在 seo-ops 做。
2. 照 `vendor/seo-ops-jsonld/README.md` 的同步指令把新 commit 複製進來，更新 README 的來源 commit。
3. 對照新的查證紀錄檢查本站輸出：有類型或屬性被淘汰就改 `site/jsonld.mjs`（連同檔頭註解）與 `site/jsonld-pages.json`；
   `courseJsonLd` 註解裡「查不到、保守保留」的屬性，若新紀錄查得到結論就照結論處理。
4. `pnpm test`、`pnpm run site`、`pnpm run validate` 全過才 commit；上線後用 `node scripts/google.mjs diagnose <網址>` 抽一頁看 Google 實際偵測結果。

