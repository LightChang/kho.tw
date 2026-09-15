// site/check-sitemap.mjs
// 檢查 dist/sitemap.xml、各分檔 sitemap 與 robots.txt。
//
// sitemap 是寫給機器看的，錯了在畫面上沒有任何徵兆：網址多編碼一次、少一個 .html、
// 或收錄到已經被清掉的頁面，都只會變成搜尋引擎那一端的 404，本站自己完全看不出來。
// 所以跟 check-links.mjs 一樣，用程式驗。
//
// 檢查項目：
//   1. XML well-formed：標籤成對、單一根節點、文字節點沒有裸露的 & 與 <
//   2. sitemap index 指到的分檔都存在，且根節點是 urlset
//   3. 每個 <loc> 都是 SITE_URL 開頭的絕對網址
//   4. 每個 <loc> 的百分比編碼與 toLoc() 一致（抓「沒編碼」與「編碼兩次」）
//   5. 解碼後對應到 dist/ 裡實際存在的檔案
//   6. 全站沒有重複 URL
//   7. 單檔 URL 數 ≤ MAX_URLS_PER_FILE、未壓縮位元組 ≤ 50 MB、index 的分檔數 ≤ 50,000
//   8. lastmod 是 YYYY-MM-DD、changefreq 是合法列舉、priority 落在 0.0–1.0
//   9. 涵蓋率：dist/ 裡每個 .html 都在 sitemap 裡，而且只出現一次
//  10. robots.txt 存在、允許檢索、Sitemap 指向存在的絕對網址
//
// 用法：node site/check-sitemap.mjs [dist 目錄]
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { SITE_URL } from './jsonld.mjs';
import {
  MAX_URLS_PER_FILE, MAX_BYTES_PER_FILE, PROTOCOL_MAX_URLS, CHANGEFREQ, toLoc,
} from './sitemap.mjs';

const DIST = process.argv[2] ?? path.resolve(import.meta.dirname, '..', 'dist');

const errs = [];
const fail = (msg) => errs.push(msg);

const exists = async (p) => {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
};

async function* htmlFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* htmlFiles(full);
    else if (entry.name.endsWith('.html')) yield full;
  }
}

const ENTITY = /&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g;
const unescapeXml = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&amp;/g, '&');

// 沒有 node_modules，所以自己做 well-formedness 檢查。
// 不是完整的 XML parser——只驗這份產出可能出錯的地方：標籤配對、根節點數、跳脫。
function checkWellFormed(xml, label) {
  if (!xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')) fail(`${label}：缺少 XML 宣告`);
  const checkText = (text) => {
    if (text.includes('<')) fail(`${label}：文字節點有裸露的 <`);
    if (text.replace(ENTITY, '').includes('&')) fail(`${label}：文字節點有未跳脫的 &`);
  };
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<(\/?)([A-Za-z_][A-Za-z0-9_.:-]*)([^>]*?)(\/?)>/g;
  const stack = [];
  let roots = 0;
  let cursor = 0;
  let m;
  while ((m = re.exec(xml)) !== null) {
    checkText(xml.slice(cursor, m.index));
    cursor = re.lastIndex;
    if (m[2] === undefined) continue; // 註解或處理指令
    const [, closing, name, , selfClose] = m;
    if (closing) {
      if (stack.pop() !== name) fail(`${label}：</${name}> 沒有對應的開始標籤`);
      if (stack.length === 0) roots += 1;
    } else if (selfClose) {
      if (stack.length === 0) roots += 1;
    } else {
      stack.push(name);
    }
  }
  checkText(xml.slice(cursor));
  if (stack.length) fail(`${label}：${stack.length} 個標籤沒有關閉（${stack.join(' > ')}）`);
  if (roots !== 1) fail(`${label}：根節點有 ${roots} 個，應該只有 1 個`);
}

const blocks = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => m[1]);
const field = (block, tag) => block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1];

async function checkUrlset(file, name, seen) {
  const xml = await readFile(file, 'utf-8');
  const bytes = Buffer.byteLength(xml, 'utf-8');
  checkWellFormed(xml, name);
  if (!/<urlset\b/.test(xml)) fail(`${name}：根節點不是 urlset`);
  if (!xml.includes('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"')) {
    fail(`${name}：urlset 缺少 sitemap 0.9 namespace`);
  }

  const urls = blocks(xml, 'url');
  if (urls.length > MAX_URLS_PER_FILE) fail(`${name}：${urls.length} 個 URL，超過每檔上限 ${MAX_URLS_PER_FILE}`);
  if (bytes > MAX_BYTES_PER_FILE) fail(`${name}：未壓縮 ${bytes} bytes，超過 50 MB 上限`);

  let missing = 0;
  let firstMissing = '';
  for (const block of urls) {
    const rawLoc = field(block, 'loc');
    if (!rawLoc) {
      fail(`${name}：有 <url> 沒有 <loc>`);
      continue;
    }
    const loc = unescapeXml(rawLoc);
    if (!loc.startsWith(`${SITE_URL}/`)) {
      fail(`${name}：${loc} 不是 ${SITE_URL} 開頭的絕對網址`);
      continue;
    }
    if (seen.has(loc)) fail(`重複的 URL：${loc}（${seen.get(loc)} 與 ${name}）`);
    else seen.set(loc, name);

    // 解碼成檔案路徑，再反向編一次比對——沒編碼與編碼兩次都會在這裡露餡
    const rel = decodeURIComponent(new URL(loc).pathname).replace(/^\//, '');
    if (toLoc(SITE_URL, rel) !== rawLoc) fail(`${name}：${loc} 的百分比編碼不正確（應為 ${toLoc(SITE_URL, rel)}）`);
    if (!(await exists(path.join(DIST, rel)))) {
      missing += 1;
      if (!firstMissing) firstMissing = rel;
    }

    const lastmod = field(block, 'lastmod');
    if (lastmod && !/^\d{4}-\d{2}-\d{2}$/.test(lastmod)) fail(`${name}：lastmod 格式不對（${lastmod}）`);
    const changefreq = field(block, 'changefreq');
    if (changefreq && !CHANGEFREQ.has(changefreq)) fail(`${name}：changefreq 不是合法列舉（${changefreq}）`);
    const priority = field(block, 'priority');
    if (priority && !(Number(priority) >= 0 && Number(priority) <= 1)) fail(`${name}：priority 超出 0.0–1.0（${priority}）`);
  }
  if (missing) fail(`${name}：${missing} 個 URL 在 dist/ 找不到對應檔案（例：${firstMissing}）`);
  return { count: urls.length, bytes };
}

async function checkRobots() {
  const file = path.join(DIST, 'robots.txt');
  if (!(await exists(file))) {
    fail('robots.txt 不存在');
    return null;
  }
  const text = await readFile(file, 'utf-8');
  if (!/^User-agent:\s*\*/m.test(text)) fail('robots.txt：沒有 User-agent: * 這一組規則');
  if (/^Disallow:\s*\/\s*$/m.test(text)) fail('robots.txt：出現 Disallow: /，會擋掉全站');
  if (!/^Allow:\s*\//m.test(text)) fail('robots.txt：沒有 Allow: /');
  const sitemapLine = text.match(/^Sitemap:\s*(\S+)$/m)?.[1];
  if (!sitemapLine) {
    fail('robots.txt：沒有 Sitemap: 這一行');
    return null;
  }
  if (!sitemapLine.startsWith(`${SITE_URL}/`)) fail(`robots.txt：Sitemap 不是 ${SITE_URL} 開頭的絕對網址（${sitemapLine}）`);
  const rel = new URL(sitemapLine).pathname.replace(/^\//, '');
  if (!(await exists(path.join(DIST, rel)))) fail(`robots.txt：Sitemap 指到不存在的檔案（${rel}）`);
  return sitemapLine;
}

async function main() {
  const indexFile = path.join(DIST, 'sitemap.xml');
  if (!(await exists(indexFile))) {
    process.stderr.write(`${indexFile} 不存在——先跑 npm run site\n`);
    process.exitCode = 1;
    return;
  }

  const indexXml = await readFile(indexFile, 'utf-8');
  checkWellFormed(indexXml, 'sitemap.xml');
  if (!/<sitemapindex\b/.test(indexXml)) fail('sitemap.xml：根節點不是 sitemapindex');

  const children = blocks(indexXml, 'sitemap');
  if (children.length > PROTOCOL_MAX_URLS) fail(`sitemap.xml：收了 ${children.length} 個分檔，超過上限 ${PROTOCOL_MAX_URLS}`);

  const seen = new Map(); // URL → 出現在哪個分檔
  const stats = [];
  for (const block of children) {
    const rawLoc = field(block, 'loc');
    const loc = rawLoc ? unescapeXml(rawLoc) : '';
    if (!loc.startsWith(`${SITE_URL}/`)) {
      fail(`sitemap.xml：分檔網址不是 ${SITE_URL} 開頭的絕對網址（${loc}）`);
      continue;
    }
    const lastmod = field(block, 'lastmod');
    if (lastmod && !/^\d{4}-\d{2}-\d{2}$/.test(lastmod)) fail(`sitemap.xml：分檔 lastmod 格式不對（${lastmod}）`);
    const name = new URL(loc).pathname.replace(/^\//, '');
    const file = path.join(DIST, name);
    if (!(await exists(file))) {
      fail(`sitemap.xml：分檔 ${name} 不存在`);
      continue;
    }
    stats.push({ name, ...(await checkUrlset(file, name, seen)) });
  }

  // 涵蓋率：dist/ 的 .html 與 sitemap 收錄的網址要一對一
  const onDisk = new Set();
  for await (const f of htmlFiles(DIST)) onDisk.add(path.relative(DIST, f).split(path.sep).join('/'));
  const inSitemap = new Set([...seen.keys()].map((loc) => decodeURIComponent(new URL(loc).pathname).replace(/^\//, '')));
  const notListed = [...onDisk].filter((f) => !inSitemap.has(f));
  const notHtml = [...inSitemap].filter((f) => !onDisk.has(f));
  if (notListed.length) fail(`${notListed.length} 個 dist/ 的 .html 沒有進 sitemap（例：${notListed.slice(0, 3).join('、')}）`);
  if (notHtml.length) fail(`${notHtml.length} 個 sitemap 網址不是 dist/ 的 .html 頁面（例：${notHtml.slice(0, 3).join('、')}）`);

  const robots = await checkRobots();

  const mb = (b) => `${(b / 1024 / 1024).toFixed(2)} MB`;
  process.stderr.write(`sitemap.xml：${stats.length} 個分檔，共 ${seen.size} 個 URL\n`);
  for (const s of stats) process.stderr.write(`  ${s.name}　${s.count} 個 URL、${mb(s.bytes)}\n`);
  process.stderr.write(`dist/ 的 .html：${onDisk.size} 個，全部收錄\n`);
  if (robots) process.stderr.write(`robots.txt：允許全站檢索，Sitemap → ${robots}\n`);

  if (errs.length === 0) {
    process.stderr.write('沒有發現問題\n');
    return;
  }
  process.stderr.write(`\n${errs.length} 個問題：\n`);
  for (const e of errs.slice(0, 20)) process.stderr.write(`  ${e}\n`);
  if (errs.length > 20) process.stderr.write(`  …另外 ${errs.length - 20} 個\n`);
  process.exitCode = 1;
}

await main();
