// site/home.mjs
// 首頁：滿版一頁（100dvh），橫豎都不可捲。
//
// 四個門各管一個面向，不是四選一：
//   現在可報名（時效）／學什麼（類型）／在哪裡（縣市）／搜尋（已知道要找什麼）
// 中段右側是「快額滿」——名額數字只有軒恩報名系統與臺中聯網給得出來，
// 是本站少數別處看不到的資訊。排序依額滿比例，同一場館最多兩筆（見 transform/emit.mjs）。
import { HOME_CSS } from './theme.mjs';

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const fmt = (n) => Number(n ?? 0).toLocaleString('en-US');

export function renderHome(home, { page }) {
  const t = home.totals;
  const topCities = home.cities.slice(0, 8);
  const topTypes = home.types.slice(0, 6);
  // 最多 12 列，實際顯示幾列由視窗高度的斷點決定（見 theme.mjs）
  const hot = home.almostFull.slice(0, 12);

  // 門卡的數字要撐滿卡片寬度，位數多就自動縮小（見 theme.mjs 的 .door .n）。
  // CSS 沒辦法知道字串多長，所以在這裡把字元數當變數傳過去。
  const bigNum = (n) => {
    const s = fmt(n);
    return `<span class="n tnum" style="--len:${s.length}">${s}</span>`;
  };

  const body = `
<div class="home">
  <header class="ask">
    <p class="brand">kho.tw</p>
    <h1>想學什麼？現在還報得到</h1>
    <form id="f" role="search">
      <input id="q" type="search" autocomplete="off" aria-label="搜尋課程、單位或講師"
        placeholder="課名、單位、講師">
      <button type="submit">搜尋</button>
    </form>
    <p class="tally" id="tally">收錄 <b class="tnum">${fmt(t.courses)}</b> 門課、<b class="tnum">${fmt(t.venues)}</b> 個上課地點，其中 <b class="tnum">${fmt(t.open)}</b> 門正在招生</p>
  </header>

  <nav class="doors" aria-label="主要入口">
    <a class="door open" href="/open.html">
      <span class="k">現在可報名</span>
      <span class="d">還沒截止的課</span>
      ${bigNum(t.open)}
      <span class="u">門課程</span>
    </a>
    <a class="door" href="/types.html">
      <span class="k">學什麼</span>
      <span class="d">社大、運動中心、樂齡、職訓</span>
      ${bigNum(home.types.length)}
      <span class="u">種課程類型</span>
    </a>
    <a class="door" href="/cities.html">
      <span class="k">在哪裡</span>
      <span class="d">依縣市找離你近的</span>
      ${bigNum(home.cities.length)}
      <span class="u">個縣市</span>
    </a>
    <a class="door" href="/search.html">
      <span class="k">搜尋</span>
      <span class="d">課名、單位都能找</span>
      ${bigNum(t.teachers)}
      <span class="u">位講師可查</span>
    </a>
  </nav>

  <section class="hot" aria-labelledby="hot-h">
    <h2 id="hot-h">快額滿</h2>
    <p class="sub">依額滿比例排序；名額由來源每日更新，只有運動中心與臺中社大提供剩餘名額</p>
    <ol>
      ${hot.map((c) => `<li><a href="/course/${esc(c.id)}.html" title="已報名 ${c.capacity - c.available}／${c.capacity} 人">
        <span class="left tnum">剩 ${c.available}<span class="cap">／${c.capacity}</span></span>
        <span class="t">${esc(c.title)}</span>
        <span class="w">${esc(c.provider)}</span>
      </a></li>`).join('')}
    </ol>
  </section>

  <footer class="foot">
    <div class="row">
      <span class="lbl">縣市</span>
      <ul>${topCities.map((c) => `<li><a href="/city/${encodeURIComponent(c.name)}.html">${esc(c.name)} <span class="tnum meta-2">${fmt(c.open)}</span></a></li>`).join('')}</ul>
      <a class="more" href="/cities.html">全部 ${home.cities.length} 縣市 →</a>
    </div>
    <div class="row">
      <span class="lbl">類型</span>
      <ul>${topTypes.map((k) => `<li><a href="/type/${encodeURIComponent(k.kind)}.html">${esc(k.label)} <span class="tnum meta-2">${fmt(k.n)}</span></a></li>`).join('')}</ul>
    </div>
    <p class="note">
      <span>縣市數字為招生中課程數。各縣市收錄深度不同（新北僅抓近 180 天），數字不代表當地實際課程總量。</span>
      <span>更新於 ${esc(home.updatedAt)}</span>
    </p>
  </footer>
</div>
<script>
const q=document.getElementById('q'),tally=document.getElementById('tally'),base=tally.innerHTML;
let idx=null;
async function load(){if(!idx)idx=await(await fetch('/index.json')).json();return idx}
q.addEventListener('input',async()=>{
  const v=q.value.trim();
  if(v.length<2){tally.innerHTML=base;return}
  const rows=await load();
  const hit=rows.filter(r=>r[1].includes(v)||r[9].includes(v)||(r[11]||'').includes(v));
  tally.innerHTML=hit.length?'找到 <b class="tnum">'+hit.length.toLocaleString('en-US')+'</b> 門：'+hit.slice(0,3).map(r=>r[1].slice(0,14)).join('、')+'⋯　按 Enter 看全部':'找不到相符的課程，換個說法試試';
});
document.getElementById('f').addEventListener('submit',e=>{
  e.preventDefault();
  const v=q.value.trim();
  if(v)location.href='/search.html?q='+encodeURIComponent(v);
});
</script>`;

  return page('kho.tw 全台成人課程｜現在還報得到的課', body, {
    description: `全台社區大學、運動中心、樂齡中心與職訓課程共 ${fmt(t.courses)} 門，其中 ${fmt(t.open)} 門正在招生。`,
    extraCss: HOME_CSS,
    bare: true,
    // 首頁把共用 CSS 一起內嵌，不連外部 /style.css。
    // 它是「滿版一頁」（100dvh、兩軸不可捲），外部樣式表在載入完成前會先用無樣式的
    // 高度算一次版面，讀者會看到一次閃爍與跳動。其餘 42,460 頁走外部檔省下 193 MB，
    // 但首頁就一頁，內嵌的代價只有 4.7 KB——這裡買的是不閃爍。
    inlineCss: true,
  });
}
