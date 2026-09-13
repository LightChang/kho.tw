// transform/slug.mjs
// 可讀網址（slug）的產生規則與登記簿。課程頁 /course/<slug>.html、場館頁 /venue/<slug>.html
// 的檔名與網址都由這裡決定，站內連結、canonical、JSON-LD、sitemap 全部跟著走。
//
// 形式：課名-單位-短碼（場館是 場館名-短碼），例如
//   飛越拉拉二胡-五權社大-8d29b
//   臺北市中山運動中心-2dad8
//
// 四件事在這裡一次講清楚，因為每一件做錯的代價都是「網址變了、收錄全失效」：
//
// 1. 穩定性：登記簿才是保證，正規化只是減少雜訊
//    `data/slugs.ndjson` 是 id → slug 的 append-only 登記簿。**同一個 id 只會配給一次 slug**，
//    之後每次重跑都直接讀回來，課名改了、單位改名了、連這支程式的規則改了都不會動到它。
//    正規化（去標點、去空白）只是讓「還沒配給過的課」不要因為來源多打一個空白就換字面，
//    它擋不住真正的改名——擋得住的是登記簿。下架的課保留原行不刪，
//    這樣網址不會被別門課撿去用，來源把課放回來時也拿得回原本的網址。
//
// 2. 唯一性：同名課程非常多（實測 5,690 組課名重複、最大一組 117 門）
//    先用「課名＋單位」分開，仍然撞到的才補短碼。短碼取自 id 的尾碼（id 本身是
//    sha256 前 8 碼），預設 5 碼；撞到就加長到 6、7、8 碼，最長就是完整 id 尾碼，
//    而 id 唯一，所以一定收斂。5 碼是權衡：百萬分之一的碰撞空間只用在「同課名同單位」
//    這種通常個位數的小群組上，夠用；而每個網址只多 6 個字元（含連字號），
//    不會變成整串亂碼。實測結果見 docs/pipeline.md §7。
//
// 3. 長度：中文百分比編碼後一個字 9 個字元，所以字數就是網址長度
//    課名取 20 字、單位取 12 字（課名 p90 是 16 字、單位 p90 是 11 字，
//    絕大多數根本不會被截）。最長 slug 編碼後約 300 字元，加網域仍在 350 以內。
//
// 4. 檔案系統安全：用白名單，不用黑名單
//    只留 Unicode 文字與數字（`\p{L}\p{N}`），其餘一律拿掉。這一刀同時解決了
//    `/`、`:`、`?`、`*`、`"`、`<`、`>`、`|`、`\`、控制字元、前後空白、句點結尾
//    （實測課名裡這些字元全部出現過），也不必逐個列黑名單怕漏。
//    字串一律正規化成 NFC；唯一性比對再折一次大小寫，
//    因為 macOS 的檔案系統大小寫不敏感，`ZUMBA-…` 與 `zumba-…` 會互相覆蓋。
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

// 課名與場館名的字數上限（以 code point 計）
export const MAX_TITLE = 20;
// 單位（主辦）的字數上限
export const MAX_PROVIDER = 12;
// 短碼長度，由短到長依序嘗試；最後一段就是完整的 id 尾碼
export const CODE_LENGTHS = [5, 6, 7, 8];

const FULLWIDTH = /[！-～]/g;
const toHalf = (s) => s.replace(FULLWIDTH, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

// 「財團法人」「社團法人」是登記型態不是名字（實測 350 個單位、1,168 門課的名稱以它開頭），
// 留著會吃掉 4 個字的辨識額度，把「財團法人臺北市華夏婦女文教基金會」截成
// 「財團法人臺北市華夏婦女文」——看不出是哪一家。去掉之後是「華夏婦女文教基金會」。
const LEGAL_PREFIX = /^(財團法人|社團法人)/;

const CITY_PREFIX = /^(臺北市|新北市|桃園市|臺中市|臺南市|高雄市|基隆市|新竹市|新竹縣|嘉義市|嘉義縣|苗栗縣|彰化縣|南投縣|雲林縣|屏東縣|宜蘭縣|花蓮縣|臺東縣|澎湖縣|金門縣|連江縣)/;

// 只留文字與數字。全形英數先轉半形，NFC 正規化後再過濾，
// 避免同一個字因為組合字序不同而產生兩種檔名。
export function normalizeName(raw) {
  return toHalf(String(raw ?? '').normalize('NFC')).replace(/[^\p{L}\p{N}]/gu, '');
}

// 「【11/18開課】抒壓玩水彩」的開頭區塊是促銷用語，會隨開課日期變動，
// 留著等於把不穩定的東西寫進網址，所以先剝掉；全部剝完會變空字串時就不剝。
export function stripPromoPrefix(raw) {
  let s = String(raw ?? '').trim();
  while (true) {
    const next = s.replace(/^\s*[【\[［][^】\]］]*[】\]］]\s*/, '');
    if (next === s || next === '') break;
    s = next;
  }
  return s;
}

// 依 code point 截斷（不是 length，否則會把一個字剖半成兩個代理對）
export const clip = (s, max) => [...s].slice(0, max).join('');

// 「臺中市五權社區大學」→「五權社大」、「嘉義市嘉義市社區大學」→「嘉義市社大」、
// 「雅藝職能技術顧問有限公司」→「雅藝職能技術顧問」。
// 目的是拿掉每個單位都有的共同字尾，讓 12 字的額度花在真正能分辨的字上。
export function shortProvider(raw) {
  const s = toHalf(String(raw ?? '').normalize('NFC'))
    .replace(/\s+/g, '')
    .replace(/台/g, '臺')
    .replace(LEGAL_PREFIX, '')
    .replace(CITY_PREFIX, '')
    .replace(/社區大學$/, '社大')
    .replace(/樂齡學習中心$/, '樂齡中心')
    .replace(/國民運動中心$/, '運動中心')
    .replace(/(股份有限公司|有限公司|基金會附設|財團法人)$/, '');
  return clip(normalizeName(s), MAX_PROVIDER);
}

// 課程的可讀部分：課名-單位。兩段都可能被截斷，截完仍為空的用「課程」墊底，
// 讓網址至少是 /course/課程-1a2b3.html 而不是 /course/-1a2b3.html。
export function courseSlugBase(course) {
  const title = clip(normalizeName(stripPromoPrefix(course.title)), MAX_TITLE) || '課程';
  const provider = shortProvider(course.provider?.nameRaw);
  return provider ? `${title}-${provider}` : title;
}

// 場館的可讀部分：場館名。名稱本身已經夠分辨（實測 2,247 個場館只有 7 個是站台代碼），
// 不再加縣市——多數場館名裡本來就有縣市名。
export function venueSlugBase(venue) {
  const name = String(venue.name ?? '').normalize('NFC').replace(/\s+/g, '').replace(LEGAL_PREFIX, '');
  return clip(normalizeName(name), MAX_TITLE) || '場館';
}

// 講師的可讀部分：姓名-單位。只放姓名不夠分辨——實測 3,028 個姓名（36%）出現在兩個以上的
// 開課單位，而本站的講師身分就是「姓名＋單位」（理由見 transform/teachers.mjs），
// 網址把單位寫出來，才看得出 /teacher/陳建志-… 指的是哪一位。仍然撞到的由短碼分開。
export function teacherSlugBase(teacher) {
  const name = clip(normalizeName(teacher.name), MAX_TITLE) || '講師';
  const provider = shortProvider(teacher.provider);
  return provider ? `${name}-${provider}` : name;
}

// 唯一性比對用的鍵：折大小寫（macOS 檔案系統大小寫不敏感）。
export const slugKey = (kind, slug) => `${kind}:${slug.normalize('NFC').toLowerCase()}`;

// 短碼的來源。id 是 crs_/ven_ ＋ sha256 前 8 碼；不是這個形狀的（例如將來出現
// 帶名稱的 id）就改用 id 自己的 sha256，反正只要求「同一個 id 永遠算出同一組碼」。
function seedOf(id) {
  const tail = String(id).split('_').at(-1) ?? '';
  if (/^[0-9a-f]{8}$/.test(tail)) return tail;
  return createHash('sha256').update(String(id)).digest('hex').slice(0, 8);
}

/**
 * 讀取登記簿。檔案不存在就是空的（第一次跑）。
 * @param {string} file data/slugs.ndjson 的絕對路徑
 */
export async function loadSlugRegistry(file) {
  let rows = [];
  try {
    const text = await readFile(file, 'utf-8');
    rows = text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    rows = [];
  }
  const reg = { file, byId: new Map(), taken: new Map(), added: 0 };
  for (const r of rows) {
    reg.byId.set(r.id, r);
    reg.taken.set(slugKey(r.kind, r.slug), r.id);
  }
  return reg;
}

/**
 * 配給（或讀回）一個 id 的 slug。已經配給過的直接回傳，不會因為 base 改變而改變。
 * @param {object} reg   loadSlugRegistry() 的回傳值
 * @param {{id: string, kind: 'course'|'venue', base: string, today: string}} o
 * @returns {string} slug
 */
export function assignSlug(reg, { id, kind, base, today }) {
  const known = reg.byId.get(id);
  if (known) return known.slug;
  const seed = seedOf(id);
  let slug = '';
  for (const n of CODE_LENGTHS) {
    const candidate = `${base}-${seed.slice(-n)}`.normalize('NFC');
    if (!reg.taken.has(slugKey(kind, candidate))) {
      slug = candidate;
      break;
    }
  }
  // 完整尾碼還撞到 → 兩個 id 的尾碼相同，只可能是 id 本身重複；不猜，直接報錯。
  if (!slug) throw new Error(`${id} 的 slug 無法配給：${base}-${seed} 已被 ${reg.taken.get(slugKey(kind, `${base}-${seed}`))} 用走`);
  const row = { id, kind, slug, assignedAt: today };
  reg.byId.set(id, row);
  reg.taken.set(slugKey(kind, slug), id);
  reg.added += 1;
  return slug;
}

/**
 * 寫回登記簿，依 id 排序（產生檔要能看 diff）。已存在的行一個字都不動。
 * @returns {Promise<{total: number, added: number}>}
 */
export async function saveSlugRegistry(reg) {
  const rows = [...reg.byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  await mkdir(path.dirname(reg.file), { recursive: true });
  await writeFile(reg.file, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf-8');
  return { total: rows.length, added: reg.added };
}
