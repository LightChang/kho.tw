// ingest/sources/center-timetable-images.mjs
// 只公開「圖片課表」的新北市國民運動中心：新莊、中和、五股。課表沒有文字層也沒有報名系統可讀，
// 所以抓圖（或圖片轉成的 PDF）→ 交給 _vision.mjs 用主機的 headless claude 讀圖 → 驗證 → 輸出。
// 圖片沒換就用 data/vision-cache/ 的快取，不會每輪重讀（見 _vision.mjs 檔頭）。
//
// 各館課表在哪（2026-09-29 實測）：
//   新莊（頂尖）  官網首頁「課程查詢」連到 Google Drive 的 PDF（游泳／體適能／球類／韻律各一份），
//                 PDF 是 Acrobat 把掃描圖轉成的（Image Conversion Plug-in），pdftotext 抽不到字。
//                 pdftoppm 轉成 150 dpi JPEG 再讀；快取鍵用 PDF 本身。
//   中和（長佳）  官網是 Wix。泳訓課表在「洛德游泳學校」頁「泳訓課程表」圖庫；其他課表是部落格文章
//                 （blog-feed.xml），文章內文的圖（figure-IMAGE 裡的 wow-image）就是課表。
//                 App（mraytec）不碰：沒有公開的網頁版。
//   五股（展昭）  17fit（wugu.17fit.com）用瀏覽器實測可以載入，但 webapi/branch-class-schedule 三個分館
//                 都是空的——期課沒有放在 17fit 上。課表以圖片貼在官網「最新消息」（期課出爐、單月課程）。
// 蘆洲（展昭）不在這裡：它的報名連結是軒恩 bcc cc01，併入 xuanen-centers。
//
// 輸出的每筆是一門課（一個代號／星期／時段），附上是哪一館、哪一份課表、課表的雜湊。
// 已經結束的課（endDate 早於今天、或整份簡章的期間已過）不輸出。
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fetchWithRetry, htmlText, runAsScript } from './_util.mjs';
import { extractTimetable } from './_vision.mjs';

const run = promisify(execFile);
const ID = 'center-timetable-images';

export const CENTERS = {
  xz: { name: '新北市新莊國民運動中心', operator: '頂尖', address: '新北市新莊區公園路11號', home: 'https://www.xzsports.com.tw/' },
  zh: { name: '新北市中和國民運動中心', operator: '長佳', address: '新北市中和區錦和路350之2號', home: 'https://www.zhsc.com.tw/' },
  wg: { name: '新北市五股國民運動中心', operator: '展昭', address: '新北市五股區成泰路三段296號', home: 'https://wgsc.chanchao.com.tw/' },
};

export const meta = {
  id: ID,
  name: '國民運動中心圖片課表（新莊、中和、五股）',
  org: '新北市新莊、中和、五股國民運動中心（頂尖、長佳、展昭）',
  homepage: 'https://www.xzsports.com.tw/',
  license: 'UNVERIFIED（各館官網未標示）',
  updateFreq: 'UNVERIFIED（期別制，每期約兩個月，新簡章開課前一個月公布）',
  format: 'html',
  entity: 'course',
  cadence: { kind: 'course-live' },
  endpoints: [
    'https://www.xzsports.com.tw/',
    'https://www.zhsc.com.tw/blog-feed.xml',
    'https://wgsc.chanchao.com.tw/news.php?pa=getList',
  ],
  recordCount: 859, // 實測 2026-09-29：新莊 237、中和 226、五股 396（五股 09-10 與 11-12 兩期都還在）
  verifiedAt: '2026-09-29',
};

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const text = async (url) => (await fetchWithRetry(url)).text();
async function bytes(url) {
  await pause(2000);
  return Buffer.from(await (await fetchWithRetry(url)).arrayBuffer());
}
const extOf = (buf) => (buf[0] === 0x89 ? 'png' : 'jpg');

// ── 新莊 ────────────────────────────────────────────────
// 首頁課程區一格一個類別：<a href="https://drive.google.com/file/d/<id>/view…">課程查詢</a> … <a …>游泳課程</a>
export function parseXzDocs(html) {
  const labels = new Map();
  const isQuery = new Set();
  for (const m of html.matchAll(/<a[^>]*href="https:\/\/drive\.google\.com\/file\/d\/([\w-]+)\/[^"]*"[^>]*>([\s\S]*?)<\/a>/g)) {
    const label = htmlText(m[2]);
    if (label === '課程查詢') isQuery.add(m[1]);
    else if (label && !labels.has(m[1])) labels.set(m[1], label);
  }
  return [...isQuery].map((id) => ({ id, label: labels.get(id) ?? '' }));
}

async function pdfPages(pdf) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'kho-pdf-'));
  try {
    await writeFile(path.join(tmp, 'in.pdf'), pdf);
    await run('pdftoppm', ['-r', '150', '-jpeg', path.join(tmp, 'in.pdf'), path.join(tmp, 'p')]);
    const files = (await readdir(tmp)).filter((f) => f.endsWith('.jpg')).sort();
    return Promise.all(files.map(async (f) => ({ buf: await readFile(path.join(tmp, f)), ext: 'jpg' })));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

async function xzDocs() {
  const docs = [];
  for (const { id, label } of parseXzDocs(await text(CENTERS.xz.home))) {
    const pdf = await bytes(`https://drive.google.com/uc?export=download&id=${id}`);
    if (pdf.subarray(0, 4).toString() !== '%PDF') throw new Error(`新莊 ${label} 下載到的不是 PDF`);
    docs.push({
      center: 'xz', docKey: `xz:${id}`, title: label, url: `https://drive.google.com/file/d/${id}/view`,
      pages: await pdfPages(pdf), keyBufs: [pdf], context: `官網「${label}」的課程查詢 PDF。`,
    });
  }
  return docs;
}

// ── 中和 ────────────────────────────────────────────────
const WIX = (id) => `https://static.wixstatic.com/media/${id}`;
const uniq = (xs) => [...new Set(xs)];

// 「洛德游泳學校」頁：「泳訓課程表」到「泳訓師資」之間的圖庫
export function parseZhSwimImages(html) {
  const i = html.indexOf('泳訓課程表');
  const j = html.indexOf('泳訓師資', i);
  if (i < 0 || j < 0) return [];
  return uniq([...html.slice(i, j).matchAll(/83e6fd_[0-9a-f]{32}~mv2\.(?:jpg|jpeg|png)/g)].map((m) => m[0]));
}

// 部落格文章內文的圖：<figure … data-hook="figure-IMAGE"> … <wow-image id="83e6fd_…~mv2.jpg">
export function parseZhPostImages(html) {
  return uniq([...html.matchAll(/data-hook="figure-IMAGE"[\s\S]{0,1500}?<wow-image id="([^"]+)"/g)].map((m) => m[1]));
}

export function parseFeed(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => ({
    title: htmlText((m[1].match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) ?? [])[1] ?? ''),
    link: (m[1].match(/<link>([^<]+)<\/link>/) ?? [])[1] ?? '',
    pubDate: (m[1].match(/<pubDate>([^<]+)<\/pubDate>/) ?? [])[1] ?? '',
  }));
}

async function zhDocs() {
  const docs = [];
  const swimUrl = `${CENTERS.zh.home}${encodeURIComponent('洛德游泳學校')}`;
  const swim = parseZhSwimImages(await text(swimUrl));
  if (swim.length) {
    const pages = [];
    for (const id of swim) { const buf = await bytes(WIX(id)); pages.push({ buf, ext: extOf(buf) }); }
    docs.push({ center: 'zh', docKey: 'zh:swim', title: '洛德游泳學校 泳訓課程表', url: swimUrl, pages,
      context: '官網「洛德游泳學校」頁的泳訓課程表（課程由洛德游泳學校在中心泳池開設）。' });
  }
  await pause(2000);
  // 近 120 天的文章才看：更早的是上幾期的課表
  const cutoff = Date.now() - 120 * 86_400_000;
  for (const post of parseFeed(await text(`${CENTERS.zh.home}blog-feed.xml`))) {
    if (!post.link || Date.parse(post.pubDate) < cutoff) continue;
    await pause(2000);
    const ids = parseZhPostImages(await text(post.link));
    if (!ids.length) continue;
    const pages = [];
    for (const id of ids) { const buf = await bytes(WIX(id)); pages.push({ buf, ext: extOf(buf) }); }
    docs.push({ center: 'zh', docKey: `zh:post:${decodeURIComponent(post.link.split('/post/')[1] ?? post.link)}`,
      title: post.title, url: post.link, pages, context: `官網文章「${post.title}」內附的課表圖。` });
  }
  return docs;
}

// ── 五股 ────────────────────────────────────────────────
// 最新消息列表：<a href="news.php?pa=getItem&news_id=361" title="blog title">115年11-12月期課出爐囉</a>
export function parseWgNews(html) {
  const out = new Map();
  for (const m of html.matchAll(/news_id=(\d+)"[^>]*title="blog title">([^<]+)</g)) out.set(m[1], htmlText(m[2]));
  return [...out].map(([id, title]) => ({ id, title }))
    .filter((n) => /期課|課程/.test(n.title) && !/體驗|水質/.test(n.title));
}

async function wgDocs() {
  const docs = [];
  const base = CENTERS.wg.home;
  for (const n of parseWgNews(await text(`${base}news.php?pa=getList`))) {
    await pause(2000);
    const url = `${base}news.php?pa=getItem&news_id=${n.id}`;
    const imgs = uniq([...(await text(url)).matchAll(/src="(upload_files\/news\/\d+\.(?:jpg|jpeg|png))/g)].map((m) => m[1]));
    if (!imgs.length) continue;
    const pages = [];
    for (const src of imgs) { const buf = await bytes(`${base}${src}`); pages.push({ buf, ext: extOf(buf) }); }
    docs.push({ center: 'wg', docKey: `wg:news:${n.id}`, title: n.title, url, pages,
      context: `官網最新消息「${n.title}」內附的簡章圖。` });
  }
  return docs;
}

// ── 組合 ────────────────────────────────────────────────
const monthNow = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 7);
const todayStr = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

export async function fetchRaw() {
  const out = [];
  let docsSeen = 0;
  for (const [center, load] of [['xz', xzDocs], ['zh', zhDocs], ['wg', wgDocs]]) {
    let docs;
    try {
      docs = await load();
    } catch (err) {
      // 一館的網站掛了就整支失敗，保留上一輪的 raw（不要讓一館的課整批消失）
      throw new Error(`${CENTERS[center].name} 課表清單失敗：${err.message}`);
    }
    let n = 0;
    for (const d of docs) {
      docsSeen++;
      const res = await extractTimetable({
        sourceId: ID, docKey: d.docKey, venue: CENTERS[center].name, pages: d.pages, keyBufs: d.keyBufs, context: d.context,
      });
      if (!res) continue;
      if (res.periodEndMonth && res.periodEndMonth < monthNow()) continue;
      for (const c of res.courses) {
        if (c.endDate && c.endDate < todayStr()) continue;
        out.push({ ...c, _center: center, _docKey: d.docKey, _docTitle: d.title, _docUrl: d.url,
          _periodStartMonth: res.periodStartMonth, _periodEndMonth: res.periodEndMonth, _visionHash: res.hash });
        n++;
      }
    }
    process.stderr.write(`[${ID}] ${CENTERS[center].name} ${docs.length} 份課表 ${n} 門\n`);
  }
  if (!docsSeen) throw new Error('三館都找不到任何課表，版面可能改了');
  return out;
}

await runAsScript(import.meta.url, meta, fetchRaw);
