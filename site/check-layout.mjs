// site/check-layout.mjs
// 首頁「滿版一頁」的版面檢查腳本（給 playwright_evaluate 用的純函式，也可貼進瀏覽器主控台）。
//
// 為什麼要有這支：先前只檢查「每個區塊的 bottom 有沒有超出視窗」，
// 結果 390×844 下底部文字壓在門的卡片上卻完全沒被抓到——因為每個框確實都還在
// 844px 內，是中段被壓縮後「卡片內容溢出自己的格子」與相鄰區塊重疊。
// 所以檢查必須包含三件事，缺一不可：
//   1. 頁面兩軸都不可捲（scrollWidth/Height vs clientWidth/Height）
//   2. 相鄰區塊的垂直範圍不可互相重疊（.ask / .doors / .hot / .foot）
//   3. 每個容器的內容要放得下（scrollHeight <= clientHeight），否則就是被裁掉
export const CHECK_LAYOUT = `(() => {
  const de = document.scrollingElement || document.documentElement;
  const vw = window.innerWidth, vh = window.innerHeight;
  const rect = (el) => { const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right) }; };
  const regions = ['.ask', '.doors', '.hot', '.foot']
    .map((sel) => ({ sel, el: document.querySelector(sel) }))
    .filter((r) => r.el && r.el.offsetParent !== null)
    .map((r) => ({ sel: r.sel, ...rect(r.el) }));

  // 相鄰區塊重疊：同一欄（水平範圍有交集）且垂直範圍有交集才算重疊
  const overlaps = [];
  for (let i = 0; i < regions.length; i++) {
    for (let j = i + 1; j < regions.length; j++) {
      const a = regions[i], b = regions[j];
      const vOverlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      const hOverlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      if (vOverlap > 1 && hOverlap > 1) overlaps.push(a.sel + ' ∩ ' + b.sel + ' = ' + vOverlap + 'px');
    }
  }

  // 內容被裁：容器裝不下自己的內容
  const clipped = [];
  for (const el of document.querySelectorAll('.home, .ask, .doors, .door, .hot, .hot li, .foot, .foot ul')) {
    if (el.offsetParent === null && el !== document.querySelector('.home')) continue;
    if (el.scrollHeight > el.clientHeight + 1) {
      clipped.push((el.className || el.tagName) + ' 內容 ' + el.scrollHeight + 'px > 容器 ' + el.clientHeight + 'px');
    }
  }

  // .hot ol 不在上面那份清單裡，因為它「刻意」裁切：容器高度是 round(down, 100%, --row-h)，
  // 十二列一律渲染，放不下的整列被裁在列與列的邊界上。對它要驗的不是「有沒有被裁」，
  // 而是「有沒有列被切在中間」——只要出現半截列，就是 --row-h 跟真實列高對不上。
  // （2026-09-14 把 46.6px 寫成 47px，八列累積 3.2px 誤差，第九列就露出一條。）
  const halfCut = [];
  const hotOl = document.querySelector('.hot ol');
  if (hotOl && hotOl.offsetParent !== null) {
    const olTop = hotOl.getBoundingClientRect().top, olH = hotOl.clientHeight;
    let n = 0;
    for (const li of hotOl.querySelectorAll('li')) {
      n++;
      const r = li.getBoundingClientRect();
      const top = Math.round(r.top - olTop), bottom = Math.round(r.bottom - olTop);
      if (top < olH - 1 && bottom > olH + 1) {
        halfCut.push('快額滿第 ' + n + ' 列被切在中間（' + top + '–' + bottom + 'px，容器 ' + olH + 'px）');
      }
    }
  }

  const outside = regions.filter((r) => r.bottom > vh + 1 || r.right > vw + 1).map((r) => r.sel);

  // 空白頁會讓上面每一項都通過——沒有內容，當然不溢出、不重疊、也不裁切。
  // 這是最危險的假通過（playwright 會間歇性停在 about:blank，整份文件只有 39 個字元），
  // 所以要求關鍵元素真的在場。**不要求「快額滿至少一列」**：那一塊在 ≤900px 寬與
  // ≤560px 高是刻意整塊隱藏的，拿它當必要條件會把正常的窄視窗判成失敗。
  const doorCount = document.querySelectorAll('.door').length;
  const bodyText = (document.body.innerText || '').trim();
  const missing = [];
  if (!document.querySelector('.home')) missing.push('找不到 .home');
  if (doorCount !== 4) missing.push('門卡不是四張（實際 ' + doorCount + ' 張）');
  if (!document.querySelector('.tally')) missing.push('找不到 .tally');
  if (bodyText.length < 200) missing.push('頁面文字只有 ' + bodyText.length + ' 字，可能是空白頁');

  // 660px 以下首頁刻意改成可捲（見 theme.mjs 的同名斷點）：門卡內容有物理下限，
  // 在 18px 的字級下限之下約 70px，而 460 的中段容器只有 16px。容器再小就只有兩條路
  // ——把內容裁掉，或讓頁面捲動。選了後者，所以這裡不能再把「可直捲」算成失敗。
  // 橫捲則是任何高度都不允許。
  const allowScrollY = vh <= 660;
  const scrollX = de.scrollWidth > de.clientWidth;
  const scrollY = de.scrollHeight > de.clientHeight;

  return {
    viewport: vw + 'x' + vh,
    scrollable: { x: scrollX, y: scrollY, y可接受: allowScrollY },
    regions,
    overlaps,
    clipped: clipped.slice(0, 12),
    clippedCount: clipped.length,
    halfCut,
    outsideViewport: outside,
    missing,
    pass: missing.length === 0
      && !scrollX && (!scrollY || allowScrollY)
      && overlaps.length === 0 && clipped.length === 0 && halfCut.length === 0
      && (allowScrollY || outside.length === 0),
  };
})()`;
