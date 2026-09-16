# GEO：生成式引擎最佳化的監看指標

GEO 在這裡指 **Generative Engine Optimization**——ChatGPT、Gemini、Perplexity、Copilot
這類生成式引擎在回答「台中哪裡有樂齡電腦課」時，會不會取用並引用本站。
（地理／在地覆蓋是另一回事，那屬於資料管線的座標與行政區，見 `docs/pipeline.md`。）

**這份文件不寫任何現況數字**，理由與規則見 `docs/SEO.md` 開頭。

## 1. 先講清楚能驗與不能驗的

生成式引擎**不提供** Search Console 那樣的官方後台：沒有「你被引用了幾次」的 API。
所以這份文件分成兩類指標：**可以用指令驗的**（§2、§3）與**只能靠人抽查的**（§5）。
不要把不能驗的事寫成數字，那是編造。

## 2. AI 爬蟲的存取政策

本站目前**全站開放給所有 user-agent**，沒有針對任何 AI 爬蟲設規則。查現況：

```bash
curl -s https://kho.tw/robots.txt
```

要改成擋某些 AI 爬蟲，就改 `site/sitemap.mjs` 裡產生 `robots.txt` 的那段字串（不是手改 `dist/`，
每次 build 都會重寫）。**這是政策決定不是技術決定**：本站資料來自政府開放資料與各單位公開課程資訊，
擋掉 AI 爬蟲等於放棄被生成式引擎引用的機會，要擋之前先想清楚為什麼。

`llms.txt`（給 LLM 的站台導覽檔）目前沒有做。確認現況：

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://kho.tw/llms.txt    # 404 = 沒做
```

要做的話，產生方式應該比照 sitemap：由程式在 build 時產出，不要手寫一份會過期的靜態清單。

## 3. 生成式引擎取用得到的內容

生成式引擎多半直接讀 HTML，不執行 JavaScript。所以**內容必須在初始 HTML 裡**。
本站除了搜尋頁與地圖頁，其餘頁面都是靜態產出的完整內容。驗證某一頁不靠 JS 也讀得到內容：

```bash
# 取一個課程網址
curl -s https://kho.tw/sitemap-courses-1.xml | grep -o '<loc>[^<]*</loc>' | head -1 | sed 's/<[^>]*>//g'

# 純文字取出來看（不執行 JS，等同爬蟲看到的）
curl -s "<上一步的網址>" \
  | perl -0pe 's/<(script|style)\b[^>]*>.*?<\/\1>//gs; s/<[^>]*>/ /g; s/\s+/ /g' \
  | cut -c1-600
```

產出的 HTML 是壓縮成一行的，所以**要先把 `<script>`、`<style>` 整段拿掉再抽文字**，
否則 `head` 只會看到 GA 的程式碼；也因為只有一行，用 `head -n` 限制行數沒有意義，要用 `cut -c` 限制字元數。

兩頁例外，知道就好，不是缺陷：
- `/search.html` 的結果由前端讀 `/index.json` 算繪
- `/map.html` 的點位由前端讀 `/venues-map.json` 算繪

兩者的內容在別處都有靜態版本（課程頁、縣市頁、場館頁），所以不影響引用。

## 4. 願意被引用的三個條件

生成式引擎引用一個來源時看的是「這裡有別處沒有的事實、而且說得出出處」。本站的三項：

- **跨來源合併後的最終值＋各來源並排**：同一門課在多個來源出現時，課程頁會列出每個來源提供了哪些欄位、
  最後確認日期，以及落選的不同值。
- **名額倒數**：只有部分來源給得出剩餘名額，這是本站少數別處看不到的資訊。
- **每日更新的報名狀態**：靠 `data/observation/` 的 append-only 軌跡累積。

這三項的現況都用指令查，不寫在文件裡：

```bash
# 有幾門課掛著兩個以上來源（跨來源合併的規模）
node -e "
const fs=require('fs');let n=0,multi=0;
for(const l of fs.readFileSync('data/courses.ndjson','utf8').split('\n')){if(!l)continue;const c=JSON.parse(l);n++;
 if((c.sources||[]).length>1)multi++;}
console.log('課程',n,'兩個以上來源',multi,(100*multi/n).toFixed(1)+'%');"

# 有幾門課給得出剩餘名額
node -e "
const fs=require('fs');let n=0;
for(const l of fs.readFileSync('data/courses.ndjson','utf8').split('\n')){if(!l)continue;const c=JSON.parse(l);
 if(Number.isFinite(c.enrollment&&c.enrollment.available))n++;}
console.log('有剩餘名額數字的課程',n);"
```

## 5. 只能人工抽查的部分

沒有 API 可以查「生成式引擎有沒有引用本站」。要知道就自己去問，並把當次結果記在 commit 訊息或
issue 裡，**不要寫進這份文件**（寫了就會過期）。抽查方式：

1. 到 ChatGPT／Gemini／Perplexity 問幾個本站應該答得出來的問題，例如
   「台北市有哪些社區大學的二胡課現在還能報名」。
2. 看回答有沒有引用 kho.tw、引用的事實對不對。
3. 引用錯誤的事實才是要修的——那代表頁面上的陳述會被誤讀，回頭改頁面寫法。

間接訊號可以看流量來源：生成式引擎導過來的流量，`sessionSource` 會是 chatgpt.com、
perplexity.ai、gemini.google.com 這類網域。

```bash
node scripts/google.mjs ga [天數]
```

輸出分兩段：依日期的使用者／工作階段／瀏覽次數，以及**參照來源前 20 名**（來源／媒介與工作階段數）。

判讀時注意兩個常見值不是「來源網域」：`(direct) / (none)` 是直接輸入網址或來源不明，
`(not set) / (not set)` 是 GA 還沒歸因完成。兩者都不代表有 AI 引擎導流。
