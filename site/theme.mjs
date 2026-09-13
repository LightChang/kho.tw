// site/theme.mjs
// kho.tw 自己的視覺系統（不沿用 seh.tw 的色票）。
//
// 兩個前提決定了這套設計：
//   1. 使用者是想找課的成人與樂齡族群，字要大、對比要夠。base 18px 起跳，
//      首頁數字用 clamp 隨視窗縮放，不用固定 px。
//   2. 報名狀態是本站最重要的資訊，所以顏色帶語意且全站一致：
//      招生中=綠、額滿=紅、尚未開放=琥珀、開課中=藍、停開=灰。
//   色彩用 OKLCH 並附 hex fallback；Lightness 壓在 0.45–0.55，淺底對比達 WCAG AA。

export const CSS = `
:root{
  --bg:oklch(0.98 0.004 250);
  --surface:#fff;
  --line:oklch(0.89 0.006 250);
  --ink:oklch(0.22 0.012 250);
  --ink-2:oklch(0.46 0.012 250);
  --ink-3:oklch(0.60 0.010 250);
  --link:oklch(0.48 0.15 250);
  --open:oklch(0.48 0.16 150);
  --full:oklch(0.54 0.21 25);
  --upcoming:oklch(0.55 0.15 65);
  --running:oklch(0.52 0.13 240);
  --idle:oklch(0.60 0.010 250);
  --fs-xs:0.95rem; --fs-sm:1.05rem; --fs-base:1.15rem; --fs-lg:1.4rem;
  --fs-xl:1.9rem; --fs-2xl:2.6rem;
  --radius:10px;
}
@supports not (color: oklch(0 0 0)){
  :root{
    --bg:#f8f9fb;--line:#dde1e7;--ink:#1d2430;--ink-2:#5a6472;--ink-3:#8c94a1;
    --link:#1f5bbf;--open:#1a7f4f;--full:#c23127;--upcoming:#b06b12;--running:#2a68c0;--idle:#8c94a1;
  }
}
*{box-sizing:border-box}
html,body{margin:0}
body{
  background:var(--bg);color:var(--ink);
  font:var(--fs-base)/1.65 system-ui,"Noto Sans TC","PingFang TC",sans-serif;
}
a{color:var(--link);text-decoration:none}
a:hover{text-decoration:underline}
.tnum{font-variant-numeric:tabular-nums}

/* 狀態：全站一致的語意色 */
.st{display:inline-block;padding:1px 10px;border-radius:999px;font-size:var(--fs-xs);
  border:1px solid currentColor;white-space:nowrap}
.st-open{color:var(--open)}
.st-full{color:var(--full)}
.st-upcoming{color:var(--upcoming)}
.st-running{color:var(--running)}
.st-cancelled,.st-closed,.st-unknown{color:var(--idle)}
/* 「課程已於 X 結束」講的是上課期間，不是報名狀態（見 site/build.mjs 的 hasEnded）。
   刻意不用 .st 的膠囊外框，免得被當成第七種報名狀態。 */
.ended{color:var(--ink-3);font-size:var(--fs-xs);white-space:nowrap}

/* 內頁（課程／縣市／場館）共用 */
.wrap{max-width:1040px;margin:0 auto;padding:28px 20px 64px}
.topbar{background:var(--surface);border-bottom:1px solid var(--line)}
.topbar .inner{max-width:1040px;margin:0 auto;padding:14px 20px;display:flex;gap:18px;align-items:baseline}
.topbar b{font-size:var(--fs-lg)}
.topbar a{color:var(--ink)}
.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);
  padding:18px 20px;margin-bottom:14px}
.card h2{margin:0 0 6px;font-size:var(--fs-xl);line-height:1.3}
.card h3{margin:0 0 10px;font-size:var(--fs-lg)}
.meta{color:var(--ink-2);font-size:var(--fs-sm)}
.meta-2{color:var(--ink-3);font-size:var(--fs-xs)}
table{width:100%;border-collapse:collapse;font-size:var(--fs-sm)}
th,td{border-bottom:1px solid var(--line);padding:9px 6px;text-align:left;vertical-align:top}
th{color:var(--ink-2);font-weight:600;white-space:nowrap}
.chips{display:flex;flex-wrap:wrap;gap:8px 14px;list-style:none;margin:0;padding:0}
.chips a{display:inline-flex;align-items:baseline;gap:6px;padding:4px 12px;border:1px solid var(--line);
  border-radius:999px;background:var(--surface);font-size:var(--fs-sm)}
.chips .n{color:var(--ink-3);font-size:var(--fs-xs)}
`;

// 首頁專用：滿版一頁，橫豎都不可捲
export const HOME_CSS = `
.home{
  height:100vh;height:100dvh;overflow:hidden;
  display:grid;
  grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);
  grid-template-rows:auto minmax(0,1fr) auto;
  grid-template-areas:"ask ask" "doors hot" "foot foot";
  column-gap:clamp(20px,3vw,46px);
  padding:clamp(14px,2.2vh,28px) clamp(18px,4vw,56px) clamp(12px,2vh,24px);
}
.ask{grid-area:ask}
.brand{font-size:var(--fs-sm);color:var(--ink-3);letter-spacing:.08em}
.ask h1{margin:2px 0 clamp(8px,1.4vh,16px);font-size:clamp(1.7rem,3.2vw,2.6rem);line-height:1.25}
.ask form{display:flex;gap:10px}
.ask input{flex:1;min-width:0;font:inherit;padding:12px 16px;border:1px solid var(--line);
  border-radius:var(--radius);background:var(--surface);color:var(--ink)}
.ask input:focus{outline:3px solid color-mix(in oklch,var(--link) 40%,transparent);outline-offset:1px}
.ask button{font:inherit;font-weight:700;padding:12px 22px;border:0;border-radius:var(--radius);
  background:var(--link);color:#fff;cursor:pointer}
.tally{margin:clamp(6px,1vh,12px) 0 0;color:var(--ink-2);font-size:var(--fs-sm)}
.tally b{color:var(--ink)}

.doors{grid-area:doors;min-height:0;display:grid;gap:clamp(8px,1.4vh,14px);
  grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr}
/* 門卡不能被壓到比內容小：中段是 minmax(0,1fr)，視窗一矮就把卡片壓扁，
   內容溢出格子後會和底部文字疊在一起（1366×600 實測 .doors 內容 328px、容器只有 230px，
   底部「縣市／類型」兩行直接蓋在下排兩張卡上）。
   所以矮視窗要縮小卡片內容本身，而不是讓它溢出。 */
/* container-type 讓卡片自己成為度量單位：底下的 .n 用 cqw 就是「卡片內容寬度的百分比」，
   不必去猜視窗寬度，欄寬一變數字就跟著變。 */
.door{container-type:inline-size;
  display:flex;flex-direction:column;justify-content:center;gap:2px;
  min-height:0;overflow:hidden;
  padding:clamp(8px,1.6vh,20px) clamp(12px,1.6vw,22px);
  border:1px solid var(--line);border-radius:var(--radius);background:var(--surface);color:var(--ink)}
.door:hover{border-color:var(--link);text-decoration:none}
.door .k{font-size:clamp(1.15rem,1.7vw,1.5rem);font-weight:800}
.door .d{font-size:var(--fs-sm);color:var(--ink-2)}
/* 數字盡量放大，位數多就自動縮小——字級由「卡片寬度 ÷ 位數」決定，不是固定級數。
   --len 是字串長度（含千分位逗號），由 site/home.mjs 傳進來。
   係數 1.55：等寬數字每字約 0.62em，1.62 會讓寬度剛好等於內寬（0.62×1.62≈1.004），
   等於一點邊都不留——實測 1024×768 與 390×844 的五位數就是這樣貼齊甚至溢出。
   降到 1.55 留約 4% 餘裕；逗號比數字窄，實際還會再鬆一些。
   上限 4rem 不是美觀取捨，是防止「9」這種單字元把卡片撐高——首頁是滿版一頁，
   卡片一撐高就爆版。所以寬度算出來再大也不超過它。 */
.door .n{margin-top:auto;font-weight:800;line-height:1.1;
  font-size:clamp(1.5rem, calc(100cqw / var(--len,3) * 1.55), 4rem)}
.door .u{font-size:var(--fs-xs);color:var(--ink-3)}
/* 窄視窗只留標題、數字與單位：1024×768 實測「社大、運動中心、樂齡、職訓」
   會折行把「職訓」拆成「職／訓」。四個門一起隱藏說明，保持一致。
   說明消失後 .n 的 margin-top:auto 會把數字推到卡片底部、標題下方留一大塊空白，
   所以同時取消那個推擠，讓數字接在標題後面。 */
@media (max-width:1100px){
  .door .d{display:none}
  .door{justify-content:center;gap:4px}
  /* 窄視窗的卡片矮很多（1024×768 實測 191px），數字若還吃 4rem 上限，
     光數字行高就 70px，加上標題與單位容易把卡片撐高——首頁是滿版一頁，撐高就爆版。
     所以上限跟著卡片一起收，位數自適應的公式不變。 */
  .door .n{margin-top:2px;font-size:clamp(1.4rem, calc(100cqw / var(--len,3) * 1.55), 2.8rem)}
  /* 這裡試過三種列高，記錄下來免得再繞一次：
       1fr 1fr ＋ .n{margin-top:auto} → 數字被推到卡片底部，標題下方空 81px（卡片內部空洞）
       auto auto ＋ align-content:center → 卡片縮到內容高，但整組浮在中段，左上空一塊
       auto auto ＋ align-content:start → 頂端對齊了，左欄下方卻空 138px，右欄滿到底
     取消 margin-top:auto 之後卡片內容本來就置中，撐滿列高只是留白變多、不會有空洞，
     所以回到 1fr 1fr：左右兩欄等高，中段填滿。 */
  .doors{gap:clamp(10px,2vh,18px)}
}
.door.open .n{color:var(--open)}

.hot{grid-area:hot;min-height:0;display:flex;flex-direction:column}
.hot h2{margin:0 0 6px;font-size:var(--fs-lg)}
.hot .sub{margin:0 0 8px;color:var(--ink-3);font-size:var(--fs-xs)}
/* 列不可壓縮：flex:1 會把每列均分容器高度，視窗一矮就把文字切掉
   （1366×600 實測每列容器 18px、內容需要 23px，八列全被裁）。
   改成自然行高，再由視窗高度決定顯示幾列——寧可少列，不要半列。 */
.hot ol{list-style:none;margin:0;padding:0;flex:1;min-height:0;overflow:hidden;
  display:flex;flex-direction:column;justify-content:flex-start}
.hot li{border-top:1px solid var(--line);flex:0 0 auto;display:flex}
.hot li a{display:flex;align-items:center;gap:12px;width:100%;padding:4px 2px;color:var(--ink);
  min-height:1.9em}
.hot .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--fs-sm)}
/* 場館名欄加寬到 45%：先前 32% 會把「臺北市中山運動中心」截成「臺北市中山運動中…」。
   加寬後改由課名截斷（課名多半較短，且滑鼠移上去有完整名稱）。 */
.hot .w{flex:none;color:var(--ink-3);font-size:var(--fs-xs);max-width:45%;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap}
.hot .left{flex:none;font-weight:800;color:var(--full);font-size:var(--fs-sm);white-space:nowrap}
/* 原本用比例條，但實測每列都是 97–98%，紅條長度幾乎一樣、看不出差別，
   還讓右邊緣參差。改成直接寫「剩 1／30」：班多大才是真正的差異。 */
.hot .cap{color:var(--ink-3);font-weight:600;font-size:var(--fs-xs)}

.foot{grid-area:foot;border-top:1px solid var(--line);padding-top:clamp(8px,1.4vh,14px);
  display:grid;gap:6px;font-size:var(--fs-sm)}
.foot .row{display:flex;gap:14px;align-items:baseline;min-width:0}
.foot .lbl{flex:none;width:5.2em;color:var(--ink-3);font-size:var(--fs-xs)}
/* max-height 會把換行後超出的項目直接切掉。1024×768 實測切掉的正好是
   「全部 21 縣市 →」那個導覽連結——切掉一個連結比切掉一個標籤嚴重，
   所以連結獨立放在行尾（.more，不參與換行），清單本身只放標籤。 */
.foot ul{display:flex;flex-wrap:wrap;gap:2px 16px;list-style:none;margin:0;padding:0;min-width:0;
  max-height:2.9em;overflow:hidden}
.foot .more{flex:none;margin-left:auto;white-space:nowrap;font-size:var(--fs-xs)}
/* 窄視窗少放幾個縣市，讓清單維持兩行以內。
   390×844 實測：留 5 個標籤仍會換到第三行被 max-height 切掉，所以手機再減到 3 個。 */
@media (max-width:1200px){ .foot ul li:nth-child(n+7){display:none} }
@media (max-width:1040px){ .foot ul li:nth-child(n+6){display:none} }
@media (max-width:560px){ .foot ul li:nth-child(n+5){display:none} }
/* 手機寬度下 .row 改成上下堆疊，2.9em 的上限反而會把僅剩的兩個標籤切掉
   （390×844 實測只剩 2 個標籤仍 cutBy:8）。這裡底部有餘裕，直接解除上限，
   讓該列依內容撐開，不要再用裁切的方式控制高度。 */
@media (max-width:900px){ .foot ul{max-height:none;overflow:visible} }
/* 390px 實測：底部每多一行就會壓縮中段的門。手機只留 2 個標籤，
   其餘走「全部 N 縣市 →」。 */
@media (max-width:420px){ .foot ul li:nth-child(n+3){display:none} }
.foot .note{color:var(--ink-3);font-size:var(--fs-xs);display:flex;gap:14px;flex-wrap:wrap}

@media (max-width:900px){
  .home{grid-template-columns:1fr;grid-template-rows:auto auto auto;
    grid-template-areas:"ask" "doors" "foot"}
  .hot{display:none}
  /* 手機的卡片最矮（390×844 實測 134px），上限再收一階，數字仍照位數自適應 */
  .door .n{font-size:clamp(1.3rem, calc(100cqw / var(--len,3) * 1.55), 2.4rem)}
  /* 手機把三段（.ask/.doors/.foot）改成依內容高度排列，門卡就不會被壓縮到溢出格子
     去撞底部文字（390×844 曾經出現底部「縣市」那行壓在下排兩張卡上）。
     這裡原本還寫了 grid-auto-rows:minmax(150px,auto) 當門卡下限，但 .doors 有顯式的
     grid-template-rows:1fr 1fr，隱式列規則根本不會套用——390×844 實測卡片 134px，
     下限從來沒生效過。與其留一條看起來有保護、實際沒作用的規則，不如拿掉。 */
  /* 「全部 N 縣市 →」在窄螢幕用 margin-left:auto 會擠到標籤右上角；
     改成接在清單後面，不另外佔一整行（佔一行會把底部撐高、擠壓中段）。 */
  .foot{padding-bottom:4px}
  .foot .row{flex-wrap:wrap}
  .foot .more{margin-left:0;order:2}
}
/* 手機：搜尋按鈕縮小，輸入框才留得住寬度（390×844 實測原本只剩 263px，
   placeholder 被截成「課名、單位、講師……例如」）。 */
@media (max-width:560px){
  .ask input{padding:11px 13px}
  .ask button{padding:11px 14px;font-size:var(--fs-sm)}
}
/* 視窗越矮，快額滿就少顯示幾列。列數由高度決定，寧可少列也不要半列被切。
   最多 12 列（1440×900 實測中段可用 445px、每列 37px 剛好放得下）。
   斷點：940/880/830/790/750/700/640/520/460px。
   斷點之後由 site/build.mjs 產出後實測微調，不要憑感覺改。 */
@media (max-height:940px){ .hot li:nth-child(n+12){display:none} }
@media (max-height:880px){ .hot li:nth-child(n+11){display:none} }
@media (max-height:830px){ .hot li:nth-child(n+10){display:none} }
@media (max-height:790px){ .hot li:nth-child(n+9){display:none} }
@media (max-height:750px){ .hot li:nth-child(n+8){display:none} }
@media (max-height:700px){ .hot li:nth-child(n+7){display:none} }
/* 640px 以下說明那行讓位給列：1366×600 實測顯示 4 列時末列下方還空 40px，
   一列 36px 放得進去，所以 600px 不再另外減列，維持 5 列。 */
@media (max-height:640px){ .hot .sub{display:none} .hot li:nth-child(n+6){display:none} }
@media (max-height:520px){ .hot li:nth-child(n+4){display:none} }
@media (max-height:460px){ .hot{display:none} }

/* 矮視窗：門卡內容依序瘦身，確保 scrollHeight <= clientHeight（實測門內容約 328px，
   1366×600 的中段只有 230px，必須降到容器以下才不會溢出去撞底部）。

   斷點是 800px 不是 760px：1366×768 會剛好掉進所有瘦身規則的空隙——
   寬 1366 > 1100 所以說明文字還在、高 768 > 760 所以門卡不瘦身，
   結果四張卡片內容 189px 塞進 185px 的容器，各溢出 4px。
   （先前那輪只驗了 1440×900／1366×600／1024×768／390×844，正好跳過 768 這一格。）
   1440×900 不受影響（900 > 800）；1024×768 本來就同時吃 max-width:1100px 的規則，
   上限從 2.8rem 再收到 2.1rem，數字略小但仍照位數自適應。 */
@media (max-height:800px){
  /* 矮視窗只收上限，不改公式——改成固定級數的話就失去自適應了 */
  /* 上限 2.1rem 不是隨手訂的：這個斷點的卡片只有 111px 高，用 2.6rem 時
     光數字行高就 46px，加上標題、說明、單位與 padding 推算是 117px，會撐破卡片。
     收到 2.1rem（行高 35px）後推算 108px，留 3px 餘裕。
     這裡的五位數本來就只佔卡片寬度的 46%，收上限不影響「數字撐滿」的觀感。 */
  .door .n{font-size:clamp(1.3rem, calc(100cqw / var(--len,3) * 1.55), 2.1rem);margin-top:4px}
  .door{gap:0}
}
@media (max-height:660px){
  /* 實測門卡內容 118px、容器 111px，差 7–9px。行高與 padding 各收一點，
     讓 scrollHeight 降到 clientHeight 以下，檢查才會真的過。 */
  .door{padding-block:6px;line-height:1.35}
  .door .k{font-size:clamp(1.05rem,1.5vw,1.25rem);line-height:1.2}
  .door .d{font-size:var(--fs-xs);line-height:1.25}
  .door .n{font-size:clamp(1.2rem, calc(100cqw / var(--len,3) * 1.55), 1.9rem);margin-top:0;line-height:1.05}
  .door .u{font-size:0.85rem;line-height:1.2}
}
@media (max-height:560px){
  .door .d{display:none}
  .door .n{font-size:clamp(1.1rem, calc(100cqw / var(--len,3) * 1.55), 1.6rem)}
  .foot ul{max-height:1.6em}
}
`;
