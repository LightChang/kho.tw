// src/lib/city-facts.mjs
// 縣市頁（/city/）頂端「先看重點」與 /cities.html 縣市比較表要用的數字，全部從課程清單算，不經人工或 AI 改寫。
//
// 2026-11-21 起：縣市頁與 /cities.html 10-28 前後在 GSC 變成 Crawled - currently not indexed。
// 搜「高雄課程」「台中市免費課程」「南投社區大學課程表」「新莊運動中心課程表」的人想知道的是：
// 這個縣市現在報得到幾門、是哪些單位開的、哪一區最多、什麼時段、多少錢。
// 原本頁面先給 66 個細項標籤、再給 30 張依開課日倒排的課程卡（排在最前面的是明年二月的兒童寒假營），
// 這幾個問題都要讀者自己拼。這裡先算好，放在最前面，再分區、分細項導到 /learn/ 頁。
//
// 「招生中」一律用 data.mjs 的 isOpen（來源寫招生中而且還沒上完），與全站其他計數同一個定義。
import { learnFacts } from './learn-facts.mjs';

// 「最近開課」那張清單只給成人看：兒童、親子課本站有收（運動中心的寒暑假營很多），但不拿來回答縣市頁的問題。
// 只從課名判斷，判斷不到的照列；這條規則只影響這張清單，不影響任何計數。
export const KID_TITLE = /兒童|幼兒|幼童|親子|學齡|國小|小學|[低中高]年級|青少年|小朋友|寶寶|寶貝|\d+\s*[-~～至]\s*\d+\s*歲/;

/**
 * @param {object} p
 * @param {object[]} p.list        這個縣市的全部課程（已依報名狀態排序）
 * @param {(c: object) => boolean} p.isOpen
 * @param {(c: object) => boolean} p.hasEnded
 * @param {string} p.today         台北日期 YYYY-MM-DD
 * @param {Map<string, string>} p.kindLabel  provider.kind → 中文名
 */
export function cityFacts({ list, isOpen, hasEnded, today, kindLabel }) {
  const f = learnFacts(list, hasEnded, today);
  const open = list.filter(isOpen);

  // 招生中的課是哪些單位開的
  const byKind = [...open.reduce((m, c) => {
    const k = c.provider?.kind;
    return k && kindLabel.has(k) ? m.set(k, (m.get(k) ?? 0) + 1) : m;
  }, new Map())].map(([kind, n]) => ({ kind, label: kindLabel.get(kind), n })).sort((a, b) => b.n - a.n);

  // 招生中、還沒開課的（開課日在今天以後）：讀者最在意的「現在報、從頭上」
  const notStarted = open.filter((c) => (c.schedule?.startDate ?? '') >= today);
  const startsByMonth = [...notStarted.reduce((m, c) => {
    const ym = c.schedule.startDate.slice(0, 7);
    return m.set(ym, (m.get(ym) ?? 0) + 1);
  }, new Map())].sort((a, b) => a[0].localeCompare(b[0]));

  // 行政區：以課程自己的行政區欄計數（不是場館），沒寫行政區的另外照實寫出
  const districts = [...list.reduce((m, c) => {
    const d = c.venue?.district;
    if (!d) return m;
    const r = m.get(d) ?? { district: d, n: 0, current: 0, open: 0 };
    r.n += 1;
    if (!hasEnded(c)) r.current += 1;
    if (isOpen(c)) r.open += 1;
    return m.set(d, r);
  }, new Map()).values()].sort((a, b) => b.open - a.open || b.current - a.current || a.district.localeCompare(b.district));
  const noDistrictOpen = open.filter((c) => !c.venue?.district).length;

  return { ...f, openN: open.length, byKind, notStarted: notStarted.length, startsByMonth, districts, noDistrictOpen };
}

/**
 * 最近開課、還能報名的成人課：開課日由近到遠；同課名同單位只留一門（射箭第一～六場次這種），
 * 同一個開課單位最多 per 門，免得一座運動中心佔滿整張清單。
 */
export function soonestOpen(list, { isOpen, today, max = 12, per = 2 }) {
  const seen = new Set();
  const perProvider = new Map();
  const out = [];
  const rows = list.filter((c) => isOpen(c) && (c.schedule?.startDate ?? '') >= today && !KID_TITLE.test(c.title ?? ''))
    .sort((a, b) => a.schedule.startDate.localeCompare(b.schedule.startDate) || a.slug.localeCompare(b.slug));
  for (const c of rows) {
    const who = c.provider?.nameRaw ?? '';
    const key = `${String(c.title).replace(/第?\s*[0-9０-９一二三四五六七八九十]+\s*(場次|梯次?|期|班)$/, '')}|${who}`;
    if (seen.has(key) || (perProvider.get(who) ?? 0) >= per) continue;
    seen.add(key);
    perProvider.set(who, (perProvider.get(who) ?? 0) + 1);
    out.push(c);
    if (out.length >= max) break;
  }
  return out;
}
