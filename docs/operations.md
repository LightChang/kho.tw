# 營運：定時抓取與觀測累積

管線本身的設計見 `docs/pipeline.md`。這份只講「怎麼讓它自己跑起來、壞掉時怎麼查」。

## 1. 為什麼需要定時跑

兩個理由，第二個比較容易被忽略：

1. **課程資料會變**：報名開了又關、課程停開、名額每天少。
2. **觀測要累積才有價值**：`data/observation/` 每跑一輪就多一筆該來源的快照。
   只跑過一輪的話，「快額滿」看到的是單點數字，不是趨勢——沒有辦法回答
   「這門課三天前還剩幾個位子」。名額倒數這個本站少數別處看不到的資訊，
   要靠每天固定抓才長得出來。

## 2. 安裝

```
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

停用之後專案本身完全不受影響，`npm run build` 照樣可以手動跑。

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
再判斷是來源改版還是真的沒課了。確認是誤判就手動跑一次 `npm run build` 繞過。

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
否則排程跑的驗證會比手動 `npm run validate` 弱，而且不會有任何徵兆。

**磁碟**
`dist/` 每次 build 會先清空再產出三萬多個檔案，`data/observation/` 隨每輪抓取累積。
這台機器目前可用空間不多，log 已設 14 天輪替；觀測資料要不要壓縮或截斷，
等累積一兩個月看實際大小再決定。
