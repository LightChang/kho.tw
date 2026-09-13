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
  for (const el of document.querySelectorAll('.home, .ask, .doors, .door, .hot, .hot ol, .hot li, .foot, .foot ul')) {
    if (el.offsetParent === null && el !== document.querySelector('.home')) continue;
    if (el.scrollHeight > el.clientHeight + 1) {
      clipped.push((el.className || el.tagName) + ' 內容 ' + el.scrollHeight + 'px > 容器 ' + el.clientHeight + 'px');
    }
  }

  const outside = regions.filter((r) => r.bottom > vh + 1 || r.right > vw + 1).map((r) => r.sel);

  return {
    viewport: vw + 'x' + vh,
    scrollable: { x: de.scrollWidth > de.clientWidth, y: de.scrollHeight > de.clientHeight },
    regions,
    overlaps,
    clipped: clipped.slice(0, 12),
    clippedCount: clipped.length,
    outsideViewport: outside,
    pass: !(de.scrollWidth > de.clientWidth) && !(de.scrollHeight > de.clientHeight)
      && overlaps.length === 0 && clipped.length === 0 && outside.length === 0,
  };
})()`;
