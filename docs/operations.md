# 營運：定時抓取與觀測累積

管線本身的設計見 `docs/pipeline.md`。這份只講「怎麼讓它自己跑起來、壞掉時怎麼查」。

> **2026-09-15 起，正式排程是 GitHub Actions（§8），本機 launchd 已停用。**
> 兩邊同時跑會各自改寫 `data/observation/`，而本機的 commit 不會推上去，下次 pull 必定衝突。
> 停用方式是 `launchctl bootout` 之後把 plist 改名成 `tw.kho.pipeline.plist.disabled`
> （launchd 只載入 `.plist`，改回原名再 `launchctl bootstrap` 就恢復）。§2–§7 保留作為本機排程的說明。

## 1. 為什麼需要定時跑

兩個理由，第二個比較容易被忽略：

1. **課程資料會變**：報名開了又關、課程停開、名額每天少。
2. **觀測要累積才有價值**：`data/observation/` 每跑一輪就多一筆該來源的快照。
   只跑過一輪的話，「快額滿」看到的是單點數字，不是趨勢——沒有辦法回答
   「這門課三天前還剩幾個位子」。名額倒數這個本站少數別處看不到的資訊，
   要靠每天固定抓才長得出來。

## 2. 安裝

```
# 網站用 Astro 建置，排程腳本直接呼叫 node_modules/astro/bin/astro.mjs，所以先裝套件。
# 沒裝的話 site 階段會記一筆「找不到 astro.mjs，請先跑 pnpm install」後結束，不會靜默失敗。
pnpm install

# plist 是安裝範本，裡面的 __KHO_ROOT__ 要換成專案的絕對路徑再放進 LaunchAgents。
# launchd 規定 ProgramArguments 與 WorkingDirectory 必須是絕對路徑，沒辦法自己推導；
# 範本留佔位符而不是寫死某台電腦的家目錄，是因為這份檔案進了公開版控。
sed "s|__KHO_ROOT__|$(pwd)|g" ops/tw.kho.pipeline.plist \
  > ~/Library/LaunchAgents/tw.kho.pipeline.plist
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/tw.kho.pipeline.plist
```

`RunAtLoad` 是 false，所以安裝當下不會立刻抓。先手動跑一次確認沒問題：

```
bash ops/run-pipeline.sh
tail -40 data/logs/pipeline-$(date +%Y-%m-%d).log
```

要立刻觸發一次排程（不等下個整點）：

```
launchctl kickstart gui/$UID/tw.kho.pipeline
```

確認有掛上：

```
launchctl print gui/$UID/tw.kho.pipeline | head -20
```

**2026-09-13 已掛上並實跑驗證**：`launchctl kickstart` 觸發一次，六個階段
（scheduler → normalize → health → cluster → relations → emit → site → 三支檢查器）
退出碼全部 0，共 132 秒，鎖檔正常釋放，`last exit code = 0`。
先前另外手動跑過一次完整抓取（當時 22 支，之後陸續接到 29 支）：
22 支中 21 支到期、**0 支失敗**
（`moe-cc-courses` 未到期），最慢的是 `xuanen-centers` 的 34 個站點，1,580 秒。
所以一輪抓取加建站約 30 分鐘，而每小時喚醒多數時候只會抓到期的少數幾支。

## 3. 停用

```
launchctl bootout gui/$UID/tw.kho.pipeline
rm ~/Library/LaunchAgents/tw.kho.pipeline.plist
```

停用之後專案本身完全不受影響，`pnpm run build` 照樣可以手動跑。

## 4. 每小時喚醒，不等於每小時抓

launchd 每小時叫醒 `ops/run-pipeline.sh`，但**哪些來源該抓是 `transform/scheduler.mjs`
自己決定的**（依 `data/schedule-state.json` 的 `nextDueAt`，間隔會隨內容有沒有變動自動調整，
見 `ingest/CONTRACT.md` §3）。多數喚醒會在幾秒內以「沒有來源到期」結束。

腳本依 scheduler 的退出碼決定後續：

| 退出碼 | 意思 | 後續 |
|---|---|---|
| 0 | 有來源內容變動 | 往下跑 normalize → health → cluster → relations → emit → site → validate |
| 2 | 到期的來源都沒變，或沒有來源到期 | 這輪結束，不重算也不重 build |
| 其他 | 抓取出錯 | 記錄後結束，不 build |

健康檢查（`transform/check-health.mjs`）沒過會**停在 build 之前**，網站維持上一版。
換期時課程數掉一半是正常的，那會是 warn 不是 fail（判斷邏輯見該檔開頭註解）。

## 5. 看 log

```
tail -f data/logs/pipeline-$(date +%Y-%m-%d).log   # 這一天的
ls -lt data/logs/                                   # 保留 14 天，超過自動刪
```

`data/logs/launchd.{out,err}.log` 只會有「bash 都還沒起來就失敗」這種錯誤，
平常是空的。腳本本身的輸出都在當日 log 裡。

## 6. 怎麼知道它壞了

排程是無人值守的，失敗若只寫進 log，實際上不會有人發現。所以每輪結束都會留下：

```
data/logs/last-run.json            最近一次的結果（結束時間、退出碼、卡在哪個階段）
data/logs/consecutive-failures     連續失敗次數；成功一次就刪掉
```

一眼看最近一次跑成什麼樣：

```
cat data/logs/last-run.json
```

**連續失敗 3 次**才會跳 macOS 系統通知。不是每次都通知，是因為來源站台三天兩頭 503
（ty.twcc、lsy.tycc 實測就是這樣），單次失敗下一輪多半自己好了；每次都吵，
結果就是通知被關掉，真的壞掉時反而沒人知道。

要調整門檻改 `ops/run-pipeline.sh` 的 `NOTIFY_AFTER`。

## 7. 故障排除

**每輪都說「上一輪還在跑，跳過這輪」**
上次跑到一半被砍掉，`data/.pipeline.lock` 留下來了。超過 6 小時腳本會自己清，
要立刻處理就 `rm -rf data/.pipeline.lock`。

**health 一直 fail，網站不更新**
`data/health-history.json` 記錄每個來源每天的筆數。先看是哪支掉了、掉多少，
再判斷是來源改版還是真的沒課了。確認是誤判就手動跑一次 `pnpm run build` 繞過。

**某支來源一直失敗**
scheduler 失敗不會改間隔，只累積失敗次數，所以不會愈退愈慢。
單獨重抓一支：`node transform/scheduler.mjs --force <來源 id>`。
看誰到期：`node transform/scheduler.mjs --list`。

**log 只寫了「找不到可執行的 node」**
`/usr/local/bin/node` 是指向 nvm 的 symlink（`~/.nvm/versions/node/<版本>/bin/node`），
nvm 換版本或清掉舊版時這條連結就會斷。改 `ops/run-pipeline.sh` 開頭的 `NODE` 變數指到新版本即可。
排程是無人值守執行，所以腳本寧可明確記一筆再結束，也不要每小時安靜地什麼都沒做。

**新增了檢查器，但排程沒跑到**
`ops/run-pipeline.sh` 末段的檢查器是逐支寫死的（目前三支：JSON-LD、站內連結、sitemap），
和 `package.json` 的 `validate` 是兩份清單。新增檢查器時兩邊都要加，
否則排程跑的驗證會比手動 `pnpm run validate` 弱，而且不會有任何徵兆。

**磁碟**
`dist/` 每次 build 會先清空再產出三萬多個檔案，`data/observation/` 隨每輪抓取累積。
這台機器目前可用空間不多，log 已設 14 天輪替；觀測資料要不要壓縮或截斷，
等累積一兩個月看實際大小再決定。

## 8. 發布到 GitHub Pages（自訂網域 kho.tw）

站台由 `.github/workflows/deploy.yml` 每小時自動建置與部署。首次設定分四步，
其中第 2 步要在 GoDaddy 後台做（本專案碰不到那裡）。

### 1. 建立 repo 並推送

```bash
gh repo create kho.tw --public --source=. --remote=origin --push
```

**免費方案的 GitHub Pages 只支援公開 repo**，所以這一步等於把整個專案公開。
推之前確認過：無金鑰、無密碼、無絕對路徑；納管內容 93 MB，都是政府開放資料與
各單位官網本來就公開的課程資訊。

### 2. 在 GoDaddy 改 DNS

`kho.tw` 的名稱伺服器是 `ns45/ns46.domaincontrol.com`（GoDaddy），所以 DNS 在 GoDaddy 後台改。

**刪掉**原本指向停放頁的兩筆：

| 類型 | 名稱 | 值 |
|---|---|---|
| A | @ | 15.197.148.33 |
| A | @ | 3.33.130.190 |

**新增** GitHub Pages 的四筆（官方值，2026-09-14 查證自 GitHub 文件，四個 IP 反查都屬 GitHub）：

| 類型 | 名稱 | 值 |
|---|---|---|
| A | @ | 185.199.108.153 |
| A | @ | 185.199.109.153 |
| A | @ | 185.199.110.153 |
| A | @ | 185.199.111.153 |

`www` 那筆改成 CNAME 指向 `lightchang.github.io`（不是 kho.tw，否則會繞回自己）。

想更省事可以只設 AAAA（IPv6）或用 ALIAS/ANAME，但 GoDaddy 的免費方案不支援 ALIAS，
所以就用上面四筆 A 記錄。

### 3. 在 repo 設定自訂網域

Settings → Pages → Source 選 **GitHub Actions**（不是 Deploy from a branch），
Custom domain 填 `kho.tw`，存檔後勾選 **Enforce HTTPS**。

憑證要等 DNS 生效後 GitHub 才簽得出來，通常十分鐘到一小時。在那之前
Enforce HTTPS 會是灰的，這是正常的，不要以為設錯了。

### 4. 觸發第一次部署

排程是每小時整點，等它自己跑也可以。要立刻跑：

```bash
gh workflow run deploy --field rebuild=true
gh run watch
```

`rebuild=true` 是因為第一次跑時多數來源還沒到期，scheduler 會回報「沒有變動」而跳過建置；
這個旗標讓它不管有沒有變動都重建並部署。

### 驗收

```bash
dig +short kho.tw A                      # 應該是上面那四個 IP
curl -sI https://kho.tw | head -3        # 應該是 200
curl -s https://kho.tw/sitemap.xml | head -3
```

### 兩個容易踩到的地方

- **`dist/CNAME` 必須每次 build 都產生。** 用 Actions 部署時 GitHub 不會自動建 CNAME 檔
  （只有「從分支發布」才會），而 build 每次都清空 `dist/`，所以 CNAME 放在 `public/`，
  由 Astro 每次複製過去。刪掉那個檔，部署一次就掉一次網域設定。
- **`KHO_SITE_URL` 設錯會污染全站 42,461 頁**的 canonical、sitemap 與 JSON-LD，
  等於叫搜尋引擎去抓不存在的網址。預設值寫在 workflow 裡（`https://kho.tw`），
  要改網址時設 repository variable `KHO_SITE_URL` 覆寫，不必動程式。

## 9. Search Console 與 Analytics

上線後要看哪些指標、用什麼指令查，分三份：`docs/SEO.md`（收錄與排名）、
`docs/AEO.md`（結構化資料）、`docs/GEO.md`（生成式引擎）。那三份一律不寫現況數字，只寫取得數字的指令。

兩個都做成開關：`KHO_GSC_VERIFY` 與 `KHO_GA_ID` 這兩個 repository variable
沒設的話，產出的 42,461 頁**一個 Google 相關標籤都不會有**——不留空 meta、
也不載入任何腳本。要停用追蹤就把變數刪掉再跑一次，不必改程式。

設定位置：repo → Settings → Secrets and variables → Actions → **Variables**（不是 Secrets，
這兩個值本來就會出現在網頁原始碼裡，不是機密）。

### Search Console：建議用 DNS TXT

你正在改 GoDaddy 的 DNS，順手一起做最省事，而且這是**網域層級**驗證：
涵蓋 http/https、www 與所有子網域，將來換主機、換部署方式都不會失效，
也不必在四萬多頁裡塞一個 meta 標籤。

1. Search Console → 新增資源 → 選左邊的「**網域**」（不是「網址前置字元」）
2. 輸入 `kho.tw`，它會給一段 `google-site-verification=xxxxxxxx`
3. 在 GoDaddy 新增一筆 TXT 記錄：名稱 `@`、值就是那整段
4. 回 Search Console 按驗證（DNS 生效前會失敗，等十分鐘再試）

若你不想動 DNS，備援是設 `KHO_GSC_VERIFY` 這個 variable（值填驗證字串的
`content` 部分），重新部署後每頁的 `<head>` 都會有那個 meta，再用「網址前置字元」驗證。

### 提交 sitemap

驗證通過後：Search Console → Sitemaps → 輸入 `https://kho.tw/sitemap.xml` → 提交。

只要提交這一個。它是 sitemap index，底下 5 個分檔 Google 會自己去抓。
限制是單檔 50 MB／50,000 個網址，本站最大的分檔是 5.44 MB／20,000 個，離上限很遠。

### Analytics（GA4）

1. GA 後台建立資源 → 資料串流 → 網站 → 填 `https://kho.tw`
2. 複製那串**評估 ID**，格式是 `G-` 開頭（不是 `UA-`，也不是 `GTM-`）
3. 設成 repository variable `KHO_GA_ID`
4. 重新部署：`gh workflow run deploy --field rebuild=true`

程式會擋掉格式錯誤的 ID（填成 `UA-`、`GTM-` 或純數字都會讓 build 失敗並說明原因）。
不擋的話，全站會載入一個永遠收不到資料的腳本，而畫面上完全看不出來。

安裝碼逐字取自 Google 官方說明，放在 `<head>` 開啟標籤之後立刻——官方要求的位置。
順序錯了不會有任何錯誤訊息，只會少收資料。

### 這件事的取捨

加了 `KHO_GA_ID` 之後，**全站 42,461 頁的每位訪客都會連到 googletagmanager.com**，
並且被設一個 `_ga` cookie。在此之前本站唯一的外部連線是地圖頁的 NLSC 圖磚（功能必需）。

台灣個資法沒有強制 cookie 同意；若在意歐盟訪客的 GDPR，就需要另外做同意機制。
不想要追蹤又想看流量的話，Cloudflare Web Analytics 之類的無 cookie 方案是替代選項，
但那要另外接，目前沒做。
