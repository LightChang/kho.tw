// src/lib/learn-facts.mjs
// 細項頁（/learn/）頂端「先看重點」卡片要用的數字，全部從課程清單算出來，不經人工或 AI 改寫。
//
// 2026-11-20 起（站主決定「現在就開始改」）：搜「三重 皮拉提斯」「成人書法課程桃園」的人，
// 想知道的是現在報不報得到、哪個時段、要多少錢。原本頁面只有一長串課程卡，
// 這幾件事要自己一張張看完才拼得出來。這裡把它們先算好，放在課程卡前面。
//
// 只算「上課還沒結束」的課：已上完的課留在清單裡當紀錄，但不拿來回答「現在」的問題。
// 費用只認來源給的數字（price／isFree），沒有費用資料的課不猜，另外計數照實寫出來。

const EVENING_FROM = '18:00';

/** 一門課的時段分類：weekend／evening／daytime；沒有星期幾的回 null。 */
export function slotKind(c) {
  const s = c.schedule?.slots?.[0];
  if (!s?.weekday) return null;
  if (s.weekday >= 6) return 'weekend';
  if (s.startTime && s.startTime >= EVENING_FROM) return 'evening';
  return s.startTime ? 'daytime' : null;
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

/**
 * @param {object[]} list  這一頁的課程（已依報名狀態排序）
 * @param {(c: object) => boolean} hasEnded
 * @param {string} today  台北日期 YYYY-MM-DD
 */
export function learnFacts(list, hasEnded, today) {
  const current = list.filter((c) => !hasEnded(c) && c.enrollment?.status !== 'cancelled');
  const open = current.filter((c) => c.enrollment?.status === 'open');
  const upcoming = current.filter((c) => c.enrollment?.status === 'upcoming');
  const opensAt = upcoming.map((c) => String(c.enrollment?.opensAt ?? '').slice(0, 10))
    .filter((d) => d && d >= today).sort();
  const full = current.filter((c) => c.enrollment?.status === 'full').length;

  const slots = { weekend: 0, evening: 0, daytime: 0, none: 0 };
  for (const c of current) slots[slotKind(c) ?? 'none'] += 1;

  const free = current.filter((c) => c.isFree === true).length;
  const prices = current.filter((c) => c.isFree !== true && Number.isFinite(c.price) && c.price > 0).map((c) => c.price);
  const price = prices.length ? { min: Math.min(...prices), max: Math.max(...prices), median: median(prices), n: prices.length } : null;

  // 最近一門還沒開課的課（開課日 >= 今天），給「現在沒有名額」時的下一步
  const nextStart = current.map((c) => c.schedule?.startDate).filter((d) => d && d >= today).sort()[0] ?? null;

  return {
    total: list.length, current: current.length, ended: list.length - current.length,
    open, upcoming: upcoming.length, nextOpensAt: opensAt[0] ?? null, full,
    slots, free, price, unpriced: current.length - free - prices.length, nextStart,
  };
}

/** meta description 用的一小段：「週末 3 門、平日晚上 5 門，標價 1,200–3,000 元」。沒有可說的就回空字串。 */
export function factsBlurb(f, fmt) {
  const parts = [];
  const when = [['weekend', '週末'], ['evening', '平日晚上'], ['daytime', '平日白天']]
    .filter(([k]) => f.slots[k] > 0).map(([k, label]) => `${label} ${fmt(f.slots[k])} 門`);
  if (when.length) parts.push(when.join('、'));
  if (f.price) parts.push(`有標價的 ${fmt(f.price.n)} 門${f.price.min === f.price.max ? ` ${fmt(f.price.min)} 元` : ` ${fmt(f.price.min)}–${fmt(f.price.max)} 元`}`);
  if (f.free > 0) parts.push(`免費 ${fmt(f.free)} 門`);
  return parts.join('，');
}
