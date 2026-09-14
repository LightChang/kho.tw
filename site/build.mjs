// site/build.mjs
// 靜態網站產生器。刻意不引入任何套件——這個專案沒有 node_modules，產出就是一堆 HTML。
//
// 輸入：data/courses.ndjson、data/venues.ndjson、public/home.json、public/index.json
// 輸出：dist/
//   index.html          首頁：滿版一頁，四個門 ＋ 快額滿（見 site/home.mjs）
//   open.html           現在可報名，依縣市分組
//   types.html          課程類型索引    type/<kind>.html   單一類型
//   cities.html         縣市索引        city/<縣市>.html   單一縣市
//   search.html         前端即時搜尋（讀 index.json，支援 ?q=）
//   course/<slug>.html  課程頁：最終值 ＋ 各來源並排 ＋ JSON-LD
//   venue/<slug>.html   場館頁
//   teachers.html       講師索引        teacher/<slug>.html 單一講師
//                       講師身分＝姓名＋開課單位，門檻 2 門課（見 transform/teachers.mjs）
//
// 檔名與站內連結一律用可讀 slug（課名-單位-短碼），不用 id。slug 由 transform/emit.mjs
// 配給、記在 data/slugs.ndjson，這裡只讀不改；規則與穩定性保證見 transform/slug.mjs。
//
// 用法：node site/build.mjs [--limit N]（--limit 只產前 N 筆課程頁，開發用）
import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import path from 'node:path';
import { CSS } from './theme.mjs';
import { renderHome } from './home.mjs';
import { renderMap } from './map.mjs';
import {
  courseJsonLd, itemListJsonLd, pageListJsonLd, venueJsonLd, courseUrl, venueUrl, teacherUrl, SITE_URL,
} from './jsonld.mjs';
import { writeSitemaps, courseHint, maxDate } from './sitemap.mjs';
import { collectTeachers, teachersWithPages, MIN_COURSES } from '../transform/teachers.mjs';
import { shortProvider } from '../transform/slug.mjs';
import { todayTaipei } from '../transform/_date.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');

const STATUS_LABEL = {
  open: '招生中', upcoming: '尚未開放報名', full: '額滿', running: '開課中',
  closed: '報名已截止', cancelled: '停開', unknown: '狀態未知',
};
const WEEKDAY_LABEL = ['', '週一', '週二', '週三', '週四', '週五', '週六', '週日'];
// 可報名的排前面，已結束的排後面
const STATUS_ORDER = { open: 0, upcoming: 1, running: 2, full: 3, unknown: 4, closed: 5, cancelled: 6 };

// 「上課已經結束」與「報名狀態」是兩件事，這裡只講前者。
//
// ingest/CONTRACT.md §5 明訂：拿上課結束日去推「報名已截止」是用上課期間冒充報名期間，
// 不可以。所以**不動 enrollment.status**——那是來源說的事實，來源沒說就是 unknown。
// 但全站 16,448 門狀態未知的課裡，有 10,767 門的上課結束日早就過了，
// 頁面上只寫「狀態未知」會讓人以為說不定還報得到。排程日期是我們手上確實有的事實，
// 照實寫出來即可，不必也不該去改報名狀態。
const TODAY = todayTaipei();
const hasEnded = (c) => Boolean(c.schedule?.endDate) && c.schedule.endDate < TODAY;
const endedNote = (c) => (hasEnded(c) ? `<span class="ended">課程已於 ${esc(c.schedule.endDate)} 結束</span>` : '');

// 站內連結：slug 是中文，每一段都要百分比編碼（與 site/sitemap.mjs 的 toLoc() 同一套規則）。
// 編碼後只剩 unreserved 字元與 %XX，不含 HTML 的特殊字元，所以不必再 esc()。
const link = (dir, slug) => `/${dir}/${encodeURIComponent(slug)}.html`;

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const fmt = (n) => Number(n ?? 0).toLocaleString('en-US');

// inlineCss：把共用 CSS 直接寫進 <style> 而不是連外部檔。
//
// 預設 false——共用 CSS 是 4,771 bytes，內嵌在 42,461 頁等於 193 MB，
// 佔 dist 總量的四成，而且每一頁都讓讀者重下載一次。改成外部 /style.css 之後
// dist 從 489 MB 降到約 296 MB（GitHub Pages 上限是 1 GB），瀏覽器也只抓一次。
//
// 只有首頁傳 true：它是「滿版一頁」，外部樣式表會有載入前的無樣式閃爍，
// 而首頁就一頁，內嵌的代價只有 4.7 KB。
function page(title, body, {
  description = '', jsonld = null, canonical = '', extraCss = '', bare = false, inlineCss = false,
} = {}) {
  // JSON-LD 內的 < 要跳成 \\u003c，否則字串裡若出現 </script> 會提前結束 script 區塊
  const ld = jsonld
    ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>`
    : '';
  const chrome = bare ? body : `
<header class="topbar"><div class="inner"><b><a href="/">kho.tw</a></b>
<a href="/open.html">可報名</a><a href="/topics.html">主題</a><a href="/types.html">類型</a><a href="/cities.html">縣市</a><a href="/map.html">地圖</a><a href="/teachers.html">講師</a><a href="/search.html">搜尋</a></div></header>
<main class="wrap">${body}</main>`;
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${description ? `<meta name="description" content="${esc(description)}">` : ''}
${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ''}
${ld}
${inlineCss ? `<style>${CSS}${extraCss}</style>` : `<link rel="stylesheet" href="/style.css">${extraCss ? `<style>${extraCss}</style>` : ''}`}</head><body>${chrome}</body></html>`;
}

const statusBadge = (s) => `<span class="st st-${esc(s ?? 'unknown')}">${esc(STATUS_LABEL[s] ?? s ?? '')}</span>`;

// markInferred：主題分類頁專用。分類是從課名推斷的就標出來，不讓推測值混在來源事實裡。
// 其餘頁面不傳這個參數（注意 .map(courseCard) 會把索引當第二個參數傳進來，所以用物件而非布林）。
function courseCard(c, { markInferred = false } = {}) {
  const slot = c.schedule?.slots?.[0];
  const when = [
    slot?.weekday ? WEEKDAY_LABEL[slot.weekday] : '',
    slot?.startTime ? `${slot.startTime}${slot.endTime ? `–${slot.endTime}` : ''}` : '',
    c.schedule?.startDate ? `自 ${c.schedule.startDate}` : '',
  ].filter(Boolean).join('　');
  const left = Number.isFinite(c.enrollment?.available)
    ? `　<span class="tnum" style="color:var(--full)">剩 ${c.enrollment.available} 位</span>` : '';
  return `<div class="card">
<div><a href="${link('course', c.slug)}">${esc(c.title)}</a> ${statusBadge(c.enrollment?.status)}${left}　${endedNote(c)}</div>
<div class="meta">${esc(c.provider?.nameRaw ?? '')}${c.venue?.city ? `　${esc(c.venue.city)}${esc(c.venue.district ?? '')}` : ''}</div>
${when ? `<div class="meta">${esc(when)}</div>` : ''}
${markInferred && c.categoryFrom === 'title' ? '<div class="meta-2">分類依課名判斷</div>' : ''}
</div>`;
}

// 已經上完的課一律排到最後，再依報名狀態、再依開課日新到舊。
// 先前只看 status，結果「狀態未知」（排序 4）的一萬多門過期課會插在
// 額滿（3）與已截止（5）之間，把還報得到的課往下擠。
const byStatusThenDate = (a, b) => (hasEnded(a) - hasEnded(b))
  || (STATUS_ORDER[a.enrollment?.status] ?? 9) - (STATUS_ORDER[b.enrollment?.status] ?? 9)
  || String(b.schedule?.startDate ?? '').localeCompare(String(a.schedule?.startDate ?? ''));

async function readNdjson(file) {
  const text = await readFile(file, 'utf-8');
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// sitemap 的條目在寫檔的同時一起收，不另外再列舉一次頁面：
// 只有真的寫出來的頁面才會進 sitemap，--limit 開發模式也就不會產出指向不存在檔案的網址。
const sitemapEntries = { pages: [], courses: [], venues: [], teachers: [] };

async function write(rel, html, sitemap) {
  const file = path.join(DIST, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, html, 'utf-8');
  if (sitemap) {
    const { group, ...meta } = sitemap;
    sitemapEntries[group].push({ rel, ...meta });
  }
}

// lastmod 用資料實際的更新日期，不用 build 當下的時間（理由見 site/sitemap.mjs）。
// 課程的日期在各來源的 lastVerifiedAt 上，取最大值；彙整頁取它收錄的課程的最大值。
const courseLastmod = (c) => maxDate((c.sources ?? []).map((s) => s.lastVerifiedAt));
const listLastmod = (list) => maxDate(list.map(courseLastmod));

// teacherPages：這門課的講師裡「有講師頁」的那些。課程頁的「講師」欄位仍然照原樣印出
// 來源字串（含「專業師資」「A、B」這種寫法，不加工），連結另外放一張卡片——
// 把來源文字改寫成連結會動到事實本身，而那一欄的用途是忠實呈現來源怎麼寫。
function coursePage(c, venue, teacherPages = []) {
  const rows = [
    ['開課期別', c.term?.raw],
    ['上課時間', (c.schedule?.slots ?? []).map((s) => `${WEEKDAY_LABEL[s.weekday] ?? ''} ${s.startTime ?? ''}${s.endTime ? `–${s.endTime}` : ''}`).join('、') || c.schedule?.timeInfoRaw],
    ['起訖日期', [c.schedule?.startDate, c.schedule?.endDate].filter(Boolean).join(' – ')],
    ['總時數', c.schedule?.hours],
    ['講師', (c.teachers ?? []).map((t) => t.nameRaw).join('、')],
    ['費用', c.isFree ? '免費' : (c.price !== undefined ? `${fmt(c.price)} 元` : c.priceText)],
    ['學分', c.credit],
    ['名額', c.enrollment?.capacity !== undefined
      ? `${c.enrollment.capacity} 人${Number.isFinite(c.enrollment.available) ? `（尚餘 ${c.enrollment.available}）` : ''}`
      : ''],
    ['報名期間', [c.enrollment?.opensAt, c.enrollment?.closesAt].filter(Boolean).map((d) => String(d).slice(0, 10)).join(' – ')],
    // 站內統一分類（18 類，見 overrides/taxonomy.json）與來源原文分開列。
    // 有些分類是從課名推斷的，標明出處，不讓推測值冒充來源事實。
    ['分類', c.category ? (c.categoryFrom === 'title' ? `${c.category}（依課名判斷）` : c.category) : ''],
    ['來源分類', c.categoryRaw],
    ['議題標籤', (c.topicsRaw ?? []).join('、')],
  ].filter(([, v]) => v !== undefined && v !== null && v !== '');

  const sources = (c.sources ?? []).map((s) => `<tr><td>${esc(s.id)}</td><td>${s.url ? `<a href="${esc(s.url)}" rel="nofollow">原始頁面</a>` : ''}</td><td class="meta-2">${esc(s.provides.join('、'))}</td><td class="meta-2">${esc(s.lastVerifiedAt ?? '')}</td></tr>`).join('');

  const body = `<div class="card">
<h2>${esc(c.title)} ${statusBadge(c.enrollment?.status)}</h2>
<div class="meta">${esc(c.provider?.nameRaw ?? '')}${c.venue?.city ? `　${esc(c.venue.city)}${esc(c.venue.district ?? '')}` : ''}</div>
${hasEnded(c) ? `<div class="meta-2">${endedNote(c)}　本站不改寫來源給的報名狀態，這一行講的是上課期間。</div>` : ''}
${c.description ? `<p>${esc(c.description)}</p>` : ''}
<table>${rows.map(([k, v]) => `<tr><th style="width:7em">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>
</div>
${venue?.id ? `<div class="card"><h3>上課地點</h3>
<div><a href="${link('venue', venue.slug)}">${esc(venue.name)}</a></div>
<div class="meta">${esc(venue.address ?? '')}</div>
<div class="meta-2">${venue.lat ? `座標 ${venue.lat}, ${venue.lng}（比對方式：${esc(c.venue.match)}）` : '尚無座標'}</div></div>`
    : `<div class="card"><h3>上課地點</h3><div class="meta">${esc(c.venue?.name ?? '來源未提供')}</div></div>`}
${teacherPages.length ? `<div class="card"><h3>講師的其他課程</h3>
<ul class="chips">${teacherPages.map((t) => `<li><a href="${link('teacher', t.slug)}">${esc(t.name)}<span class="n tnum">${fmt(t.courseIds.length)}</span></a></li>`).join('')}</ul>
<div class="meta-2">講師頁收錄的是「同名且同一開課單位」的課程，同名的不同人不會被合併。</div></div>` : ''}
<div class="card"><h3>資料來源</h3>
<table><tr><th>來源</th><th>連結</th><th>提供欄位</th><th>最後確認</th></tr>${sources}</table>
${c.rejected ? `<details class="meta-2"><summary>其他來源的不同值（${c.rejected.length}）</summary><pre style="white-space:pre-wrap">${esc(JSON.stringify(c.rejected, null, 1))}</pre></details>` : ''}
</div>`;
  const jsonld = courseJsonLd(c, venue);
  return page(`${c.title}｜${c.provider?.nameRaw ?? ''}`, body, {
    description: jsonld.description,
    canonical: courseUrl(c),
    jsonld,
  });
}

async function main() {
  const limitIdx = process.argv.indexOf('--limit');
  const limit = limitIdx >= 0 ? Number(process.argv[limitIdx + 1]) : Infinity;

  const courses = await readNdjson(path.join(ROOT, 'data', 'courses.ndjson'));
  const venues = new Map((await readNdjson(path.join(ROOT, 'data', 'venues.ndjson'))).map((v) => [v.id, v]));

  // 課程的 slug 在 data/courses.ndjson 裡，場館的沒有（venues.ndjson 是 relations 那一層寫的），
  // 所以場館的 slug 從登記簿補上。缺了就直接停，不要默默產出一堆 /venue/undefined.html。
  const slugFile = path.join(ROOT, 'data', 'slugs.ndjson');
  const slugRows = await readNdjson(slugFile).catch(() => {
    throw new Error(`找不到 ${slugFile}，請先跑 node transform/emit.mjs`);
  });
  const venueSlugs = new Map(slugRows.filter((r) => r.kind === 'venue').map((r) => [r.id, r.slug]));
  for (const v of venues.values()) {
    v.slug = venueSlugs.get(v.id);
    if (!v.slug) throw new Error(`場館 ${v.id} 在 data/slugs.ndjson 沒有 slug，請重跑 node transform/emit.mjs`);
  }
  const noSlug = courses.filter((c) => !c.slug).length;
  if (noSlug) throw new Error(`${noSlug} 門課的 data/courses.ndjson 沒有 slug，請重跑 node transform/emit.mjs`);
  const home = JSON.parse(await readFile(path.join(ROOT, 'public', 'home.json'), 'utf-8'));
  // 主題分類的清單與顯示順序以 overrides/taxonomy.json 為準（只讀不改），
  // 不從課程資料反推——反推的話某一類剛好沒課就會整類消失，順序也會跟著資料飄。
  const taxonomy = JSON.parse(await readFile(path.join(ROOT, 'overrides', 'taxonomy.json'), 'utf-8'));

  // 先清空：來源會下架課程，不清的話上一版的頁面會留在 dist/ 被一起部署
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });
  await cp(path.join(ROOT, 'public', 'index.json'), path.join(DIST, 'index.json'));
  // 共用樣式表獨立成一支（見 page() 的 inlineCss 註解）。首頁不吃這支，它自己內嵌。
  await writeFile(path.join(DIST, 'style.css'), CSS, 'utf-8');
  // Leaflet 自己放一份（見 site/map.mjs 的理由），連同它的 images/ 一起複製。
  // 從第三方 CDN 載會讓整站多一個外部信任對象，而 NLSC 圖磚已經是不可避免的那一個。
  await cp(path.join(ROOT, 'public', 'lib'), path.join(DIST, 'lib'), { recursive: true });

  // ── 首頁（滿版一頁） ──────────────────────────────
  await write('index.html', renderHome(home, { page }),
    { group: 'pages', lastmod: home.updatedAt, changefreq: 'daily', priority: '1.0' });

  // ── 現在可報名 ────────────────────────────────
  const openCourses = courses.filter((c) => c.enrollment?.status === 'open');
  const openByCity = new Map();
  for (const c of openCourses) {
    const city = c.venue?.city ?? '未標示縣市';
    if (!openByCity.has(city)) openByCity.set(city, []);
    openByCity.get(city).push(c);
  }
  const openSections = [...openByCity.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([city, list]) => `<div class="card"><h3>${esc(city)}<span class="meta-2 tnum">　${fmt(list.length)} 門</span></h3>
${list.slice(0, 12).map((c) => `<div><a href="${link('course', c.slug)}">${esc(c.title)}</a> <span class="meta-2">${esc(c.provider?.nameRaw ?? '')}</span></div>`).join('')}
${list.length > 12 && city !== '未標示縣市'
      ? `<div class="meta-2"><a href="/city/${encodeURIComponent(city)}.html">看 ${esc(city)}全部 ${fmt(list.length)} 門 →</a></div>`
      : (list.length > 12 ? `<div class="meta-2">另有 ${fmt(list.length - 12)} 門未標示縣市的課程</div>` : '')}</div>`).join('');
  await write('open.html', page('現在可報名的課程', `
<div class="card"><h2>現在可報名</h2><div class="meta">共 ${fmt(openCourses.length)} 門課還沒截止報名，依縣市分組。</div></div>
${openSections}`, {
    description: `全台 ${fmt(openCourses.length)} 門成人課程正在招生，依縣市整理。`,
    canonical: `${SITE_URL}/open.html`,
    jsonld: itemListJsonLd(openCourses.slice(0, 100), { name: '現在可報名的課程' }),
  }), { group: 'pages', lastmod: listLastmod(openCourses), changefreq: 'daily', priority: '0.9' });

  // ── 類型索引與各類型頁 ────────────────────────
  await write('types.html', page('課程類型', `
<div class="card"><h2>課程類型</h2><div class="meta">依開課單位的性質分類。</div></div>
<div class="card"><ul class="chips">${home.types.map((k) => `<li><a href="/type/${encodeURIComponent(k.kind)}.html">${esc(k.label)}<span class="n tnum">${fmt(k.n)}</span></a></li>`).join('')}</ul></div>`,
  { description: '社區大學、運動中心、樂齡中心、職業訓練等課程類型索引。', canonical: `${SITE_URL}/types.html` }),
  { group: 'pages', lastmod: listLastmod(courses), changefreq: 'weekly', priority: '0.7' });

  for (const kind of home.types) {
    const list = courses.filter((c) => c.provider?.kind === kind.kind).sort(byStatusThenDate);
    await write(`type/${kind.kind}.html`, page(`${kind.label}的課程`, `
<div class="card"><h2>${esc(kind.label)}</h2><div class="meta">共 ${fmt(list.length)} 門課，其中 ${fmt(kind.open)} 門正在招生</div></div>
${list.slice(0, 300).map(courseCard).join('')}
${list.length > 300 ? '<div class="meta-2">只列出前 300 門，其餘請用搜尋。</div>' : ''}`, {
      description: `全台${kind.label}課程共 ${fmt(list.length)} 門，其中 ${fmt(kind.open)} 門招生中。`,
      canonical: `${SITE_URL}/type/${kind.kind}.html`,
      jsonld: itemListJsonLd(list.slice(0, 100), { name: `${kind.label}的課程` }),
    }), { group: 'pages', lastmod: listLastmod(list), changefreq: 'weekly', priority: '0.7' });
  }

  // ── 主題分類索引與各分類頁 ────────────────────
  // 這 18 類是「課程主題」（overrides/taxonomy.json），與上面的「機構類型」是兩個不同的面向：
  // 同一門瑜伽課，類型是「社區大學」、主題是「運動健身」。兩套索引各自獨立，不互相取代。
  //
  // categoryFrom === 'title'（依課名推斷）的課一律收進來，不另設篩選：
  // 全站 18 類裡推斷佔 15,025 門、來源標示 11,735 門，排掉推斷的會讓多數分類頁少掉一半以上，
  // 索引就失去「我要學語言」的入口功能。但推斷是我們的判斷、不是來源講的事實，
  // 所以在卡片上標明「分類依課名判斷」，分類頁開頭也寫出這一類有幾門是推斷的。
  const byCategory = new Map(taxonomy.categories.map((name) => [name, []]));
  for (const c of courses) {
    if (!c.category) continue;
    const list = byCategory.get(c.category);
    // 資料出現 taxonomy 沒有的分類就直接停：默默丟掉的話，分類頁會少課而沒有任何徵兆。
    if (!list) throw new Error(`課程 ${c.slug} 的分類「${c.category}」不在 overrides/taxonomy.json 的 categories 裡`);
    list.push(c);
  }
  const topics = [...byCategory].filter(([, list]) => list.length)
    .map(([name, list]) => ({
      name,
      list: list.sort(byStatusThenDate),
      open: list.filter((c) => c.enrollment?.status === 'open').length,
      inferred: list.filter((c) => c.categoryFrom === 'title').length,
    }));
  const categorised = topics.reduce((n, t) => n + t.list.length, 0);

  await write('topics.html', page('課程主題分類', `
<div class="card"><h2>主題分類</h2><div class="meta">想學什麼就從這裡找。數字是該主題正在招生／全部的課程數。</div>
<div class="meta-2">全站 ${fmt(courses.length)} 門課中有 ${fmt(categorised)} 門已歸類；主題分類講的是課程內容，開課單位的性質請看<a href="/types.html">類型</a>。</div></div>
<div class="card"><ul class="chips">${topics.map((t) => `<li><a href="/topic/${encodeURIComponent(t.name)}.html">${esc(t.name)}<span class="n tnum">${fmt(t.open)}／${fmt(t.list.length)}</span></a></li>`).join('')}</ul></div>`, {
    description: `語言、電腦資訊、運動健身、料理烘焙等 ${topics.length} 類成人課程主題索引，共 ${fmt(categorised)} 門課。`,
    canonical: `${SITE_URL}/topics.html`,
    jsonld: pageListJsonLd(
      topics.map((t) => ({ url: `${SITE_URL}/topic/${encodeURIComponent(t.name)}.html`, name: t.name })),
      { name: '課程主題分類' },
    ),
  }), { group: 'pages', lastmod: listLastmod(courses), changefreq: 'weekly', priority: '0.8' });

  for (const t of topics) {
    await write(`topic/${t.name}.html`, page(`${t.name}課程`, `
<div class="card"><h2>${esc(t.name)}</h2><div class="meta">${fmt(t.list.length)} 門課，其中 ${fmt(t.open)} 門招生中</div>
${t.inferred ? `<div class="meta-2">其中 ${fmt(t.inferred)} 門是依課名判斷的分類（來源沒標分類、或標的是行政分類），卡片上會註明。</div>` : ''}</div>
${t.list.slice(0, 300).map((c) => courseCard(c, { markInferred: true })).join('')}
${t.list.length > 300 ? '<div class="meta-2">只列出前 300 門，其餘請用搜尋。</div>' : ''}`, {
      description: `全台${t.name}類成人課程共 ${fmt(t.list.length)} 門，其中 ${fmt(t.open)} 門招生中。`,
      canonical: `${SITE_URL}/topic/${encodeURIComponent(t.name)}.html`,
      jsonld: itemListJsonLd(t.list.slice(0, 100), { name: `${t.name}課程` }),
    }), { group: 'pages', lastmod: listLastmod(t.list), changefreq: 'weekly', priority: '0.7' });
  }

  // ── 縣市索引與各縣市頁 ────────────────────────
  await write('cities.html', page('各縣市課程', `
<div class="card"><h2>各縣市</h2><div class="meta">數字是該縣市正在招生的課程數。</div></div>
<div class="card"><ul class="chips">${home.cities.map((c) => `<li><a href="/city/${encodeURIComponent(c.name)}.html">${esc(c.name)}<span class="n tnum">${fmt(c.open)}／${fmt(c.n)}</span></a></li>`).join('')}</ul></div>`,
  { description: '全台 21 縣市的成人課程索引。', canonical: `${SITE_URL}/cities.html` }),
  { group: 'pages', lastmod: listLastmod(courses), changefreq: 'weekly', priority: '0.7' });

  const byCity = new Map();
  for (const c of courses) {
    const city = c.venue?.city;
    if (!city) continue;
    if (!byCity.has(city)) byCity.set(city, []);
    byCity.get(city).push(c);
  }
  for (const [city, list] of byCity) {
    list.sort(byStatusThenDate);
    const open = list.filter((c) => c.enrollment?.status === 'open').length;
    await write(`city/${city}.html`, page(`${city}的成人課程`, `
<div class="card"><h2>${esc(city)}</h2><div class="meta">${fmt(list.length)} 門課，其中 ${fmt(open)} 門招生中</div></div>
${list.slice(0, 300).map(courseCard).join('')}
${list.length > 300 ? '<div class="meta-2">只列出前 300 門，其餘請用搜尋。</div>' : ''}`, {
      description: `${city}社區大學、樂齡中心、運動中心與職訓課程共 ${fmt(list.length)} 門。`,
      canonical: `${SITE_URL}/city/${encodeURIComponent(city)}.html`,
      jsonld: itemListJsonLd(list.slice(0, 100), { name: `${city}的成人課程` }),
    }), { group: 'pages', lastmod: listLastmod(list), changefreq: 'weekly', priority: '0.7' });
  }

  // ── 場館頁 ────────────────────────────────────
  const coursesByVenue = new Map();
  for (const c of courses) {
    const id = c.venue?.id;
    if (!id) continue;
    if (!coursesByVenue.has(id)) coursesByVenue.set(id, []);
    coursesByVenue.get(id).push(c);
  }
  for (const [id, list] of coursesByVenue) {
    const v = venues.get(id);
    if (!v) continue;
    list.sort(byStatusThenDate);
    await write(`venue/${v.slug}.html`, page(`${v.name}的課程`, `
<div class="card"><h2>${esc(v.name)}</h2>
<div class="meta">${esc(v.address ?? '')}</div>
<div class="meta-2">${v.lat ? `座標 ${v.lat}, ${v.lng}` : '尚無座標'}　共 ${fmt(list.length)} 門課</div></div>
${list.slice(0, 200).map(courseCard).join('')}`, {
      description: `${v.name}的成人課程共 ${fmt(list.length)} 門。`,
      canonical: venueUrl(v),
      jsonld: venueJsonLd(v, list),
    }), { group: 'venues', lastmod: listLastmod(list), changefreq: 'weekly', priority: '0.5' });
  }

  // ── 地圖頁 ────────────────────────────────────
  // 場館為單位聚合，不是課程——19,671 門有座標的課只落在 1,782 個地點上，
  // 按場館聚合後資料從 1.3 MB 降到 78 KB，地圖也不會同一個點疊幾十個標記。
  const mapRows = [];
  let mapCourses = 0;
  let mapOpen = 0;
  for (const [id, list] of coursesByVenue) {
    const v = venues.get(id);
    if (!v || v.lat == null || v.lng == null) continue;
    const open = list.filter((c) => c.enrollment?.status === 'open').length;
    mapCourses += list.length;
    mapOpen += open;
    mapRows.push([
      v.slug, v.name, v.city ?? '', v.district ?? '',
      // 小數 5 位約 1 公尺，遠超過本站座標實際的精度，再多位數只是灌大檔案
      Number(v.lat.toFixed(5)), Number(v.lng.toFixed(5)),
      list.length, open,
    ]);
  }
  mapRows.sort((a, b) => b[6] - a[6] || String(a[0]).localeCompare(String(b[0])));
  await writeFile(path.join(DIST, 'venues-map.json'), JSON.stringify(mapRows), 'utf-8');
  await write('map.html', renderMap({
    page,
    venueCount: mapRows.length,
    courseCount: mapCourses,
    openCount: mapOpen,
    updatedAt: home.updatedAt,
  }), { group: 'pages', lastmod: home.updatedAt, changefreq: 'weekly', priority: '0.8' });

  // ── 講師頁 ────────────────────────────────────
  // 全站 8,672 個講師姓名原本只出現在課程頁的一列文字裡，沒有任何頁面回答得了
  // 「這位老師還開了哪些課」。身分認定＝姓名＋開課單位，規則與理由見 transform/teachers.mjs。
  // slug 由 emit 配給，這裡只讀；拿不到就是兩邊算出的身分不一致，直接停——
  // 默默跳過的話會少掉一批頁面，而且畫面上不會有任何徵兆。
  const teacherSlugs = new Map(slugRows.filter((r) => r.kind === 'teacher').map((r) => [r.id, r.slug]));
  const teacherIndex = collectTeachers(courses);
  const pageTeachers = teachersWithPages(teacherIndex);
  for (const t of pageTeachers) {
    t.slug = teacherSlugs.get(t.id);
    if (!t.slug) throw new Error(`講師「${t.name}」（${t.provider}）在 data/slugs.ndjson 沒有 slug，請重跑 node transform/emit.mjs`);
  }
  const courseById = new Map(courses.map((c) => [c.id, c]));
  const teachersByName = new Map();
  for (const t of pageTeachers) {
    if (!teachersByName.has(t.name)) teachersByName.set(t.name, []);
    teachersByName.get(t.name).push(t);
  }

  for (const t of pageTeachers) {
    const list = t.courseIds.map((id) => courseById.get(id)).filter(Boolean).sort(byStatusThenDate);
    const open = list.filter((c) => c.enrollment?.status === 'open').length;
    const sameName = (teachersByName.get(t.name) ?? []).filter((o) => o.id !== t.id);
    await write(`teacher/${t.slug}.html`, page(`${t.name}｜${t.provider}`, `
<div class="card"><h2>${esc(t.name)}</h2>
<div class="meta">${esc(t.provider)}</div>
<div class="meta-2">本站收錄 ${fmt(list.length)} 門課，其中 ${fmt(open)} 門招生中</div></div>
${list.slice(0, 200).map(courseCard).join('')}
${list.length > 200 ? '<div class="meta-2">只列出前 200 門，其餘請用搜尋。</div>' : ''}
${sameName.length ? `<div class="card"><h3>站內同名的其他講師頁</h3>
<div class="meta-2">本站以「姓名＋開課單位」認定講師，所以這些頁面可能是同一位老師在別的單位開課，也可能只是剛好同名的不同人。來源資料分不出來，本站就不替雙方認定。</div>
<ul class="chips">${sameName.map((o) => `<li><a href="${link('teacher', o.slug)}">${esc(o.name)}<span class="n">${esc(o.city)}${esc(shortProvider(o.provider))}</span></a></li>`).join('')}</ul></div>` : ''}
<div class="card"><div class="meta-2">本頁只整理本站已收錄課程中公開標示的講師姓名，不彙整也不推測任何其他個人資訊。資料有誤請洽原開課單位。</div></div>`, {
      description: `${t.provider}講師${t.name}在本站收錄 ${fmt(list.length)} 門課，其中 ${fmt(open)} 門招生中。`,
      canonical: teacherUrl(t),
      jsonld: itemListJsonLd(list.slice(0, 100), { name: `${t.name}的課程` }),
    }), { group: 'teachers', lastmod: listLastmod(list), changefreq: 'weekly', priority: '0.5' });
  }

  // 講師索引：頁面數上千，不可能全列在一頁上，所以只列開課最多的 300 位，
  // 其餘靠課程頁的「講師的其他課程」與 sitemap 進入——和類型／縣市頁「只列前 300」同一套作法。
  const rankedTeachers = pageTeachers.slice()
    .sort((a, b) => b.courseIds.length - a.courseIds.length || a.id.localeCompare(b.id));
  const shownTeachers = rankedTeachers.slice(0, 300);
  await write('teachers.html', page('講師', `
<div class="card"><h2>講師</h2>
<div class="meta">本站從課程資料裡認得出 ${fmt(teacherIndex.size)} 個講師身分（姓名＋開課單位），其中 ${fmt(pageTeachers.length)} 個收錄 ${MIN_COURSES} 門以上的課、有自己的頁面。</div>
<div class="meta-2">首頁「講師」那個數字算的是另一件事——課程資料裡出現過的講師姓名字面數，含「專業師資」「講師群」這類集合名稱，兩個數字不會一樣。</div>
<div class="meta-2">講師身分以「姓名＋開課單位」認定：同名的人很多，而來源只給名字、沒有任何識別碼，分不出「同一位老師跨校開課」與「剛好同名的兩個人」——所以寧可把同一位老師拆成兩頁，也不把兩個人合成一頁。只收錄一門課的講師不另外產頁，那一頁的內容會和課程頁完全重複。</div></div>
<div class="card"><h3>收錄課程最多的講師</h3>
<ul class="chips">${shownTeachers.map((t) => `<li><a href="${link('teacher', t.slug)}">${esc(t.name)}<span class="n tnum">${fmt(t.courseIds.length)}</span></a></li>`).join('')}</ul>
<div class="meta-2">另外 ${fmt(pageTeachers.length - shownTeachers.length)} 位講師的頁面可以從課程頁的「講師的其他課程」進入，或用<a href="/search.html">搜尋</a>找講師姓名。</div></div>`, {
    description: `全台成人課程的講師索引，${fmt(pageTeachers.length)} 位講師在本站的開課紀錄。`,
    canonical: `${SITE_URL}/teachers.html`,
    jsonld: pageListJsonLd(
      shownTeachers.slice(0, 100).map((t) => ({ url: teacherUrl(t), name: `${t.name}（${t.provider}）` })),
      { name: '講師索引' },
    ),
  }), { group: 'pages', lastmod: listLastmod(courses), changefreq: 'weekly', priority: '0.6' });

  // ── 搜尋頁（純前端，讀 index.json） ───────────
  await write('search.html', page('搜尋課程', `
<div class="card"><h2>搜尋</h2>
<form id="f" role="search" style="display:flex;gap:10px;margin-top:10px">
<input id="q" type="search" style="flex:1;font:inherit;padding:12px 16px;border:1px solid var(--line);border-radius:10px" placeholder="課名、單位、講師">
<button style="font:inherit;font-weight:700;padding:12px 22px;border:0;border-radius:10px;background:var(--link);color:#fff;cursor:pointer">搜尋</button></form>
<div class="meta" id="n" style="margin-top:10px">載入索引中⋯</div></div>
<div id="r"></div>
<script>
const L={open:'招生中',upcoming:'尚未開放報名',full:'額滿',running:'開課中',closed:'報名已截止',cancelled:'停開',unknown:'狀態未知'};
let idx=[];
(async()=>{idx=await(await fetch('/index.json')).json();
  document.getElementById('n').textContent='共 '+idx.length.toLocaleString('en-US')+' 門課可搜尋';
  const p=new URLSearchParams(location.search).get('q');
  if(p){document.getElementById('q').value=p;run(p)}})();
function run(v){
  const hit=idx.filter(r=>r[1].includes(v)||r[9].includes(v)||(r[10]||'').includes(v)||(r[11]||'').includes(v));
  document.getElementById('n').textContent='找到 '+hit.length.toLocaleString('en-US')+' 門課'+(hit.length>200?'（顯示前 200）':'');
  document.getElementById('r').innerHTML=hit.slice(0,200).map(r=>
    '<div class="card"><div><a href="/course/'+encodeURIComponent(r[0])+'.html">'+r[1]+'</a> <span class="st st-'+r[6]+'">'+(L[r[6]]||r[6])+'</span></div>'+
    '<div class="meta">'+r[9]+(r[2]?'　'+r[2]+(r[3]||''):'')+'</div></div>').join('');
}
document.getElementById('f').addEventListener('submit',e=>{e.preventDefault();const v=document.getElementById('q').value.trim();if(v.length>=1)run(v)});
</script>`, { description: '在 29,000 門全台成人課程中搜尋課名、單位或講師。', canonical: `${SITE_URL}/search.html` }),
  { group: 'pages', lastmod: home.updatedAt, changefreq: 'monthly', priority: '0.6' });

  // ── 課程頁 ────────────────────────────────────
  // 課程 → 有頁面的講師。講師頁的入站連結全部來自這裡，所以要在課程頁產出前先算好。
  const teacherPagesByCourse = new Map();
  for (const t of pageTeachers) {
    for (const id of t.courseIds) {
      if (!teacherPagesByCourse.has(id)) teacherPagesByCourse.set(id, []);
      teacherPagesByCourse.get(id).push(t);
    }
  }

  let n = 0;
  for (const c of courses) {
    if (n >= limit) break;
    // 停開與已截止的課仍然收錄，只是 priority 低、changefreq 長（見 site/sitemap.mjs）
    await write(`course/${c.slug}.html`, coursePage(c, venues.get(c.venue?.id), teacherPagesByCourse.get(c.id) ?? []),
      { group: 'courses', lastmod: courseLastmod(c), ...courseHint(c.enrollment?.status) });
    n += 1;
  }

  // ── sitemap 與 robots.txt ─────────────────────
  const sitemap = await writeSitemaps({
    dist: DIST,
    siteUrl: SITE_URL,
    groups: [
      { name: 'pages', entries: sitemapEntries.pages },
      { name: 'courses', entries: sitemapEntries.courses },
      { name: 'venues', entries: sitemapEntries.venues },
      { name: 'teachers', entries: sitemapEntries.teachers },
    ],
  });

  process.stderr.write(
    `dist/ 產出：首頁 1、可報名 1、類型 ${home.types.length + 1}、主題 ${topics.length + 1}、縣市 ${byCity.size + 1}、`
    + `場館 ${coursesByVenue.size}、講師 ${pageTeachers.length + 1}、搜尋 1、課程 ${n}\n`
    + `sitemap：${sitemap.total} 個 URL，分 ${sitemap.files.length} 檔（${sitemap.files.join('、')}）＋ robots.txt\n`,
  );
}

if (process.argv[1] === path.join(ROOT, 'site', 'build.mjs')) await main();
