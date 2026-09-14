// site/theme.mjs
// kho.tw 自己的視覺系統（不沿用 seh.tw 的色票）。
//
// 注意：底下 CSS 與 HOME_CSS 整份都住在模板字串裡，**CSS 註解裡不可以出現反引號**。
// 順手用反引號標記一個選擇器（寫成 `.hot li a`）就會把字串提前關掉，
// 整支模組變成語法錯誤、build 直接掛掉。要強調選擇器就寫原樣，不加標記。
//
// 兩個前提決定了這套設計：
//   1. 使用者是想找課的成人與樂齡族群，字要大、對比要夠。字級量表直接採用
//      ~/.claude/skills/design-tokens/typography.md 的官方值（base 24px，
//      最小 --fs-xs 18px「無例外」），首頁數字用 clamp 隨視窗縮放，不用固定 px。
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
  /* design-tokens/typography.md 的官方量表，不自訂：
     xs 18px（最小字級，無例外）／sm 20px／base 24px／lg 28px／xl 32px／2xl 48px／3xl 56px */
  --fs-xs:1.125rem; --fs-sm:1.25rem; --fs-base:1.5rem; --fs-lg:1.75rem;
  --fs-xl:2rem; --fs-2xl:3rem; --fs-3xl:3.5rem;
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
  font:var(--fs-base)/1.6 system-ui,"Noto Sans TC","PingFang TC",sans-serif;
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
/* 手機：導覽列改成單行橫向捲動，不換行。
   2026-09-14 加了「地圖」之後變成 8 個連結，390px 寬會折成三行、佔掉 125px，
   等於首屏 15% 被導覽列吃掉。改成可橫向滑動後固定一行（實測 52px）。
   -webkit-overflow-scrolling 讓 iOS 有慣性；scrollbar 在手機上本來就不顯示。 */
@media (max-width:560px){
  .topbar .inner{flex-wrap:nowrap;overflow-x:auto;gap:14px;padding:12px 16px;
    -webkit-overflow-scrolling:touch;scrollbar-width:none}
  .topbar .inner::-webkit-scrollbar{display:none}
  .topbar a,.topbar b{flex:none;white-space:nowrap}
}
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
/* 窄螢幕的表格：字級對齊 design-tokens 之後 th 從 16.8px 變 20px，
   320px 寬實測課程頁的表格被撐到 341px，整頁跟著橫捲。
   先解除表頭不換行（341→291px），但 320 扣掉 .wrap 與 .card 的左右 padding
   之後只剩 240px 可用，291 還是塞不下——所以再讓表格自己成為可橫捲的區塊。
   把橫捲關在表格裡，比整頁橫捲好：表格是少數「寬度本來就可能超出」的元素。 */
@media (max-width:420px){
  th{white-space:normal}
  table{display:block;overflow-x:auto;-webkit-overflow-scrolling:touch}
}
.chips{display:flex;flex-wrap:wrap;gap:8px 14px;list-style:none;margin:0;padding:0}
.chips a{display:inline-flex;align-items:baseline;gap:6px;padding:4px 12px;border:1px solid var(--line);
  border-radius:999px;background:var(--surface);font-size:var(--fs-sm)}
.chips .n{color:var(--ink-3);font-size:var(--fs-xs)}

/* 地圖頁（見 site/map.mjs）。地圖容器一定要有明確高度，Leaflet 不會自己撐開。 */
.map-card{padding:14px}
.map-tools{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px}
.map-tools button{font:inherit;font-weight:700;padding:10px 18px;border:0;border-radius:var(--radius);
  background:var(--link);color:#fff;cursor:pointer}
.map-tools select{font:inherit;padding:9px 12px;border:1px solid var(--line);
  border-radius:var(--radius);background:var(--surface);color:var(--ink)}
#map{height:min(70vh,620px);border-radius:var(--radius);border:1px solid var(--line)}
/* 手機把地圖壓矮一點，否則下面的說明與「附近」清單整個被推出畫面外 */
@media (max-width:560px){ #map{height:min(58vh,420px)} .map-tools button,.map-tools select{flex:1} }
.nearlist{list-style:none;margin:0;padding:0}
.nearlist li{border-top:1px solid var(--line);padding:9px 2px}
.nearlist li:first-child{border-top:0}
/* Leaflet 的彈出視窗沿用站內字級，不用它預設的 12px——本站讀者是成人與樂齡族群 */
.leaflet-popup-content{font:var(--fs-sm)/1.6 system-ui,"Noto Sans TC","PingFang TC",sans-serif}
.leaflet-container{font:var(--fs-xs)/1.5 system-ui,"Noto Sans TC","PingFang TC",sans-serif}
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
/* 下限對齊 --fs-lg(28px)、上限對齊 --fs-2xl(48px)，中間仍隨視窗連續縮放 */
.ask h1{margin:2px 0 clamp(8px,1.4vh,16px);font-size:clamp(1.75rem,3.2vw,3rem);line-height:1.25}
.ask form{display:flex;gap:10px}
.ask input{flex:1;min-width:0;font:inherit;padding:12px 16px;border:1px solid var(--line);
  border-radius:var(--radius);background:var(--surface);color:var(--ink)}
.ask input:focus{outline:3px solid color-mix(in oklch,var(--link) 40%,transparent);outline-offset:1px}
.ask button{font:inherit;font-weight:700;padding:12px 22px;border:0;border-radius:var(--radius);
  background:var(--link);color:#fff;cursor:pointer}
.tally{margin:clamp(6px,1vh,12px) 0 0;color:var(--ink-2);font-size:var(--fs-sm)}
.tally b{color:var(--ink)}

/* 欄寬一定要寫 minmax(0,1fr)，不能只寫 1fr：1fr 的最小值是 auto，
   也就是「不得小於內容的 min-content」，擋不住內容把欄位撐開。
   320px 實測：兩欄的 min-content 加 gap 是 327.5px，而 .home 扣掉 padding 只剩 284px，
   於是整個 .home 的欄寬被撐成 327.5px，.ask/.doors/.foot 三個區塊一起溢出、整頁橫捲。
   改成 minmax(0,1fr) 之後欄位才允許縮到比內容窄，門卡自己有 overflow:hidden 接手。 */
.doors{grid-area:doors;min-height:0;display:grid;gap:clamp(8px,1.4vh,14px);
  grid-template-columns:minmax(0,1fr) minmax(0,1fr);grid-template-rows:1fr 1fr}
/* 門卡不能被壓到比內容小：中段是 minmax(0,1fr)，視窗一矮就把卡片壓扁，
   內容溢出格子後會和底部文字疊在一起（1366×600 實測 .doors 內容 328px、容器只有 230px，
   底部「縣市／類型」兩行直接蓋在下排兩張卡上）。
   所以矮視窗要縮小卡片內容本身，而不是讓它溢出。 */
/* container-type 讓卡片自己成為度量單位：底下的 .n 用 cqw 就是「卡片內容寬度的百分比」，
   不必去猜視窗寬度，欄寬一變數字就跟著變。 */
/* 2026-09-14：門卡改「連續縮放」，不再用階梯式瘦身。
   舊做法是一組 max-height 斷點各自收字級與 padding，但斷點之間門卡的內容高度是固定的、
   容器高度卻隨視窗連續變化，所以每個斷點的正上方必定有一段區間裝不下——
   實測 841 差 4px、769 差 2px、761 差 3px 全是這個成因，跟 1366×768 破版半年是同一個病。
   把行高、gap 與 padding 都綁上 vh，內容高度就跟著容器一起連續變化，縫隙消失。
   字級本身不參與縮放：18px 是 design-tokens 的下限，「無例外」。 */
.door{container-type:inline-size;
  display:flex;flex-direction:column;justify-content:center;
  gap:clamp(0px,0.3vh,3px);
  min-height:0;overflow:hidden;
  padding:clamp(3px,1.5vh,20px) clamp(12px,1.6vw,22px);
  border:1px solid var(--line);border-radius:var(--radius);background:var(--surface);color:var(--ink)}
.door:hover{border-color:var(--link);text-decoration:none}
.door .k{font-size:clamp(1.125rem,1.7vw,1.5rem);font-weight:800;line-height:clamp(1.15em,2.6vh,1.4em)}
.door .d{font-size:var(--fs-sm);color:var(--ink-2);line-height:clamp(1.2em,2.5vh,1.5em)}
/* 數字盡量放大，位數多就自動縮小——字級由「卡片寬度 ÷ 位數」決定，不是固定級數。
   --len 是字串長度（含千分位逗號），由 site/home.mjs 傳進來。
   係數 1.55：等寬數字每字約 0.62em，1.62 會讓寬度剛好等於內寬（0.62×1.62≈1.004），
   等於一點邊都不留——實測 1024×768 與 390×844 的五位數就是這樣貼齊甚至溢出。
   降到 1.55 留約 4% 餘裕；逗號比數字窄，實際還會再鬆一些。
   上限 4rem 不是美觀取捨，是防止「9」這種單字元把卡片撐高——首頁是滿版一頁，
   卡片一撐高就爆版。所以寬度算出來再大也不超過它。 */
/* 數字同時受兩件事限制，取小者：卡片寬度 ÷ 位數（橫向放得下）與視窗高度（縱向放得下）。
   多了 6vh 這一項之後，上限不必再用 media query 分四級——視窗一矮數字自己就變小。 */
.door .n{margin-top:auto;font-weight:800;line-height:clamp(1em,4.4vh,1.15em);
  font-size:clamp(1.125rem, min(100cqw / var(--len,3) * 1.55, 6vh), 4rem)}
.door .u{font-size:var(--fs-xs);color:var(--ink-3);line-height:clamp(1.05em,2.3vh,1.4em)}
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

/* .hot 用 grid 而不是 flex，為的是讓底下 ol 的 100% 有明確參照（1fr 區域的高度）。
   flex 的 flex:1 子項算不出「我的可用高度是多少」，round() 就沒有東西可以對齊。 */
.hot{grid-area:hot;min-height:0;display:grid;grid-template-rows:auto auto 1fr}
.hot h2{margin:0 0 6px;font-size:var(--fs-lg)}
.hot .sub{margin:0 0 8px;color:var(--ink-3);font-size:var(--fs-xs)}
/* 列不可壓縮：flex:1 會把每列均分容器高度，視窗一矮就把文字切掉
   （1366×600 實測每列容器 18px、內容需要 23px，八列全被裁）。
   改成自然行高，再由容器高度決定顯示幾列——寧可少列，不要半列。

   「不要半列」以前靠一串 max-height 斷點各自寫死列數，但每列高度取決於 base 字級
   （.hot li a 的 min-height 是 1.9em），字級一改那串數字就全錯：2026-09-14 base 從
   18.4px 調到 24px，每列 37→47px，舊斷點的列數全部高估，1440×900 實測 11 列需要
   513px、容器只有 344px，清單被裁掉四成。
   改用 round(down, 100%, --row-h)：容器高度直接對齊到列高的整數倍，多出來的列被裁在
   列與列的邊界上，不會出現半列，也就不需要任何斷點。
   --row-h 必須是**精確**的列高，不能四捨五入：容器高度是 round(down, 100%, --row-h)，
   誤差會沿著列數累積。2026-09-14 第一版寫死 47px（真實值 46.6px），八列就累積出 3.2px，
   第九列在容器底部露出一條 3px 的半截——正是這段註解本來要防的事。
   改用 calc 從字級推導，字級再變也不會對不上：1.9 來自 .hot li a 的 min-height:1.9em
   （em 相對於 a 繼承的 --fs-base），+1px 是 li 的上框線。 */
.hot ol{--row-h:calc(1.9 * var(--fs-base) + 1px);
  list-style:none;margin:0;padding:0;min-height:0;overflow:hidden;
  max-height:round(down, 100%, var(--row-h));
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
  /* 同樣要 minmax(0,1fr) 而不是 1fr——理由見上面 .doors 的註解，
     桌面版的兩欄本來就是這樣寫的，手機版這行漏了。 */
  .home{grid-template-columns:minmax(0,1fr);grid-template-rows:auto auto auto;
    grid-template-areas:"ask" "doors" "foot"}
  .hot{display:none}
  /* 手機的卡片最矮（390×844 實測容器 95px），字級放大到官方量表後內容要 116px。
     padding 與 gap 各收一點、數字上限從 2.4rem 降到 2rem，讓內容回到容器以內。
     數字仍照位數自適應，只是上限變了。 */
  .door{padding-block:6px;gap:2px}
  .door .n{font-size:clamp(1.125rem, calc(100cqw / var(--len,3) * 1.55), 2rem)}
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
   **每列高度取決於 base 字級**：.hot li a 的 min-height 是 1.9em，
   base 18.4px 時每列 37px、base 24px 時每列 47px。2026-09-14 字級對齊
   design-tokens 官方量表之後，舊的列數全部高估——1440×900 實測 11 列需要
   513px、容器只有 344px，整份清單被裁掉四成。
   下面每一格的列數 = 實測容器高度 ÷ 47px 無條件捨去：
     940→381px/8列  900→344/7  880→325/6  830→279/5  790→243/5
     768→225/4  750→206/4  700→160/3  640→170/3（說明那行退場後容器反而變大）
   改字級就要重量一次，不要憑感覺調。 */
/* 列數不再由斷點決定——ol 的高度用 round() 對齊列高的整數倍，容器放得下幾列就顯示幾列。
   只剩「說明那行退場」留在斷點裡：它不是列，沒辦法用同一招處理。 */
@media (max-height:640px){ .hot .sub{display:none} }
/* 560px 以下整塊退場：容器只剩 93px，放得下 1 列——一列的「快額滿」沒有資訊價值，
   不如把高度讓給門卡（矮視窗下門卡才是主角）。 */
@media (max-height:560px){ .hot{display:none} }

/* 矮視窗：門卡內容依序瘦身，確保 scrollHeight <= clientHeight（實測門內容約 328px，
   1366×600 的中段只有 230px，必須降到容器以下才不會溢出去撞底部）。

   斷點是 800px 不是 760px：1366×768 會剛好掉進所有瘦身規則的空隙——
   寬 1366 > 1100 所以說明文字還在、高 768 > 760 所以門卡不瘦身，
   結果四張卡片內容 189px 塞進 185px 的容器，各溢出 4px。
   （先前那輪只驗了 1440×900／1366×600／1024×768／390×844，正好跳過 768 這一格。）
   1440×900 不受影響（900 > 800）；1024×768 本來就同時吃 max-width:1100px 的規則，
   上限從 2.8rem 再收到 2.1rem，數字略小但仍照位數自適應。 */
/* 行高、gap 與 padding 已經隨 vh 連續縮放（見 .door），數字上限也綁了 6vh，
   所以這裡不再有任何「瘦身階梯」。只剩一件沒辦法連續化的決定：
   字級碰到 18px 下限之後就收不動了，說明文字只能整行退場。 */
@media (max-height:720px){
  .door .d{display:none}
}
/* 660px 以下放棄「滿版一頁不可捲」，改成像內頁一樣捲動。
   理由是物理下限：門卡最少要放得下標題、數字、單位三行，在 18px 字級與最小行高下
   約 64px，加框線與 padding 約 70px。而中段容器在 640 只有 104px、560 剩 66px、
   460 只剩 16px——460 那格連一行字都放不下。
   字級不能再縮（18px 是 design-tokens 的「無例外」下限），所以只剩兩條路：
   把內容塞到溢出被裁，或讓頁面可捲。可捲的首頁比內容被裁掉的首頁誠實。
   660 這個門檻是實測來的：660 時門卡 113/113 剛好貼齊，往上全部通過。 */
@media (max-height:660px){
  .home{height:auto;min-height:100dvh;overflow:visible;
    grid-template-rows:auto auto auto}
  .doors{grid-template-rows:auto auto}
  .door{min-height:72px}
  /* 這裡刻意不設 .foot ul 的 max-height。那條上限是為了「滿版一頁」時壓縮底部而存在的，
     頁面既然已經改成可捲就沒有理由再裁；而且 max-width:900px 那條早就明訂窄螢幕要
     解除上限（max-height:none），在這裡重新設限只會依順序蓋掉它——
     320×568 實測就是這樣把兩行標籤（66px）壓進 1.6em（32px）裡。 */
}
`;
