# SEO：搜尋引擎最佳化的監看指標

**這份文件不寫任何現況數字。** 收錄數、曝光、覆蓋率這類數值每天都在變，寫進文件的那一刻就開始過期，
而過期的數字比沒有數字更糟——它看起來像事實。所以每一項指標只寫「用什麼指令拿到最新值」與「怎麼判讀」。
需要現況就跑指令，需要歷史就看 `data/`。同一條規則適用於 `docs/AEO.md`、`docs/GEO.md`。

架構與頁面種類見 `docs/pipeline.md`，排程與部署見 `docs/operations.md`。

## 0. 前置：憑證

查 Search Console 與 GA 要用 kho.tw 專屬的服務帳號（`kho-seo@kho-tw.iam.gserviceaccount.com`，
GCP 專案 `kho-tw`）。金鑰是機密，不進版控：

```bash
export KHO_GOOGLE_KEY_FILE=~/.config/kho-tw/kho-seo-key.json
```

沒有這個環境變數時，`scripts/google.mjs` 會直接說「沒有憑證」並退出，不會靜默略過。

## 1. 每週該看的四項

| 指標 | 指令 | 怎麼判讀 |
|---|---|---|
| sitemap 是否健康 | `node scripts/google.mjs check` | 錯誤與警告都應該是 0。送出數與線上網址數（見 §2）對不起來，多半只是 Google 還沒重抓最新版本 |
| 各分檔的抓取時間 | `node scripts/google.mjs diagnose` | 每個分檔都該有「下載」時間。某一檔長期停在「尚未」就要查那一檔是不是太大或回應太慢 |
| 索引狀況 | `node scripts/google.mjs diagnose <網址...>` | 見 §3 的狀態對照 |
| 搜尋成效 | `node scripts/google.mjs performance [天數]` | 曝光、點擊、平均排名，另附前 10 名頁面與查詢字詞 |

`performance` 刻意跳過最近 3 天：Search Console 的資料有延遲，最後幾天的數字之後還會變，
拿來比較會讓「昨天比前天掉了」這種判讀失真。

## 2. 線上與本機的實際數字

```bash
# 線上每個 sitemap 分檔的網址數
# 最大的分檔有數 MB，下載要一段時間。**不要加 --max-time**：逾時會截斷檔案，
# 而 grep 照樣數得出一個數字，看起來像「網址變少了」——2026-09-16 就這樣誤判過一次。
for f in pages-1 courses-1 courses-2 venues-1 teachers-1; do
  echo "$f $(curl -s https://kho.tw/sitemap-$f.xml | grep -c '<loc>')"
done

# 本機 dist/ 的頁數
find dist -name '*.html' | wc -l

# 課程數與欄位覆蓋率（描述與座標直接影響頁面品質與 JSON-LD）
node -e "
const fs=require('fs');let n=0,d=0,g=0,o=0;
for(const l of fs.readFileSync('data/courses.ndjson','utf8').split('\n')){if(!l)continue;const c=JSON.parse(l);n++;
 if(c.description)d++; if(c.venue&&c.venue.lat!=null)g++; if(c.enrollment&&c.enrollment.status==='open')o++;}
console.log('課程',n,'有描述',d,(100*d/n).toFixed(1)+'%','有座標',g,(100*g/n).toFixed(1)+'%','招生中',o);"
```

**本機 `dist/` 不一定是全量。** 開發時常用 `KHO_LIMIT=N` 只產前 N 門課程頁，
拿那份 `dist/` 數頁數會嚴重低估。要用全量對照就先重建：`pnpm run site`（不帶 `KHO_LIMIT`）。

正式站的內容以 GitHub Actions 每小時那一輪為準，本機重建只是為了對照。

## 3. 索引狀態怎麼讀

`node scripts/google.mjs diagnose <網址>` 的「收錄狀態」對照：

| 狀態 | 意思 | 要不要處理 |
|---|---|---|
| 已提交並建立索引 | 正常 | 不用 |
| 已找到 - 目前尚未建立索引 | Google 知道這頁，還沒排到 | 新站正常，數週後仍大量停在這裡才要處理 |
| Google 無法辨識的網址 | 還沒被抓過 | 新站正常 |
| 已檢索 - 目前尚未建立索引 | 抓了但判定不值得收錄 | **要處理**：內容太薄或與其他頁重複 |
| 重複網頁，Google 選擇不同的標準網頁 | canonical 被改判 | **要處理**：見下 |

`diagnose` 會比對我方宣告的 canonical 與 Google 實際選用的，不一致時標 `⚠ 不一致`。
這是本站最該提防的一項：同一門課常同時出現在多個來源，課程頁若被判定互相重複，流量會集中到 Google 選的那一頁。
真的發生時，處理方向是加強分群（讓重複的課合併成同一頁，見 `docs/pipeline.md`），不是改 canonical 去硬指。

## 4. 每次部署前的技術檢查

這三支在 `pnpm run validate` 裡，CI 每輪都會跑，失敗會擋下部署：

```bash
node site/validate-jsonld.mjs   # JSON-LD 能不能解析、必要屬性在不在、列舉值合不合法
node site/check-links.mjs       # 站內連結沒有 404
node site/check-sitemap.mjs     # sitemap 與 dist/ 的檔案一一對得起來
```

版面（滿版一頁、字級下限）不在 `validate` 裡，改版面時要另外量，做法見 `docs/pipeline.md`。

## 5. robots 與可檢索性

```bash
curl -s https://kho.tw/robots.txt
curl -sI https://kho.tw/ | head -3
```

全站開放檢索，`robots.txt` 指向 sitemap index。`/index.json` 刻意不擋——搜尋頁的內容靠它算繪，
擋掉會讓那一頁在爬蟲眼中變成空殼（理由寫在 `site/sitemap.mjs` 的註解裡）。

## 6. 流量

```bash
node scripts/google.mjs ga [天數]     # GA4：使用者、工作階段、瀏覽次數，依日期
```

GA 的評估 ID 由 repository variable `KHO_GA_ID` 控制，沒設就整站不載入任何 Google 腳本。
查現在設了什麼：`gh variable list --repo LightChang/kho.tw`。
