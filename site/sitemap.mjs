// site/sitemap.mjs
// 產生 sitemap index、分檔 sitemap 與 robots.txt。
// XML 全部自己串字串，不靠套件——所以百分比編碼與跳脫要自己顧。
//
// 三個設計取捨，理由寫在這裡免得之後有人「順手改簡單一點」：
//
// 1. 為什麼一開始就做 sitemap index，而不是單一檔案
//    協定上限是單檔 50,000 個 URL、未壓縮 50 MB。目前 31,239 個 URL 還沒超過，
//    但課程數只會再長（probe/sources.tsv 列了 41 個來源，目前才接 11 個）。
//    等超過上限才改結構，會連帶動到已經送給搜尋引擎的 sitemap 網址。
//    每檔上限壓在 20,000（協定上限的四成），留成長空間。
//
// 2. lastmod 用資料的日期，不用 build 當下的時間
//    每次 build 都寫 new Date() 的話，sitemap 的 git diff 永遠是整份都變，
//    看不出哪些課真的更新了；對搜尋引擎也是「狼來了」，久了就不信 lastmod。
//    課程用 sources[].lastVerifiedAt 的最大值，彙整頁用它收錄的課程的最大值，
//    首頁用 public/home.json 的 updatedAt。同一份資料重跑 build 產出必定相同。
//
// 3. 停開（cancelled）與已截止（closed）的課仍然收錄
//    這些頁面對「這門課還在不在、當初是什麼內容」是有答案的，抽掉只會變成 404，
//    或讓使用者在別處看到過期資訊卻找不到本站的更正。但它們不會再變動，
//    所以 priority 壓低、changefreq 拉長，把抓取預算讓給招生中的課。

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

// 協定上限：單檔 50,000 個 URL、未壓縮 50 MB；sitemap index 最多 50,000 個 sitemap。
export const PROTOCOL_MAX_URLS = 50000;
export const MAX_BYTES_PER_FILE = 50 * 1024 * 1024;
// 自訂上限：刻意低於協定上限，留成長空間。
export const MAX_URLS_PER_FILE = 20000;

export const CHANGEFREQ = new Set(['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never']);

// 報名狀態 → priority／changefreq。
// 招生中的課名額與截止日天天變，值得每天回來看；停開與已截止的不會再變。
const STATUS_HINT = {
  open: { priority: '0.9', changefreq: 'daily' },
  upcoming: { priority: '0.7', changefreq: 'weekly' },
  full: { priority: '0.6', changefreq: 'weekly' },
  running: { priority: '0.6', changefreq: 'weekly' },
  unknown: { priority: '0.5', changefreq: 'weekly' },
  closed: { priority: '0.3', changefreq: 'monthly' },
  cancelled: { priority: '0.2', changefreq: 'monthly' },
};

export const courseHint = (status) => STATUS_HINT[status] ?? STATUS_HINT.unknown;

const xmlEsc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

// dist/ 內的相對檔案路徑 → 絕對網址。
// 中文路徑（例如 city/臺北市.html）一定要百分比編碼，否則 sitemap 裡是非 ASCII 原字元，
// 不同爬蟲的處理不一致。逐段編碼，斜線要留著當路徑分隔。
// 編碼後字串只剩 unreserved 字元與 %XX，理論上不含 & < > "，
// 但仍然過一次 xmlEsc——少一個假設就少一個之後會爆的地方。
export function toLoc(siteUrl, rel) {
  const encoded = rel.split('/').map(encodeURIComponent).join('/');
  return xmlEsc(`${siteUrl}/${encoded}`);
}

// 一組日期取最大值（都是 YYYY-MM-DD，字串比大小即可）。沒有就回 undefined。
export const maxDate = (dates) => dates.filter(Boolean).sort().at(-1);

const urlNode = ({ loc, lastmod, changefreq, priority }) => `  <url>
    <loc>${loc}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}${changefreq ? `\n    <changefreq>${changefreq}</changefreq>` : ''}${priority ? `\n    <priority>${priority}</priority>` : ''}
  </url>`;

function urlsetXml(entries) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map(urlNode).join('\n')}
</urlset>
`;
}

function indexXml(files) {
  const nodes = files.map(({ name, lastmod }) => `  <sitemap>
    <loc>${name}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}
  </sitemap>`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${nodes.join('\n')}
</sitemapindex>
`;
}

const chunk = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

/**
 * 產出 dist/sitemap.xml（index）、dist/sitemap-<group>-<n>.xml 與 dist/robots.txt。
 *
 * @param {object} o
 * @param {string} o.dist     dist 目錄絕對路徑
 * @param {string} o.siteUrl  站台絕對網址，不含結尾斜線
 * @param {Array<{name: string, entries: Array<{rel: string, lastmod?: string, changefreq?: string, priority?: string}>}>} o.groups
 * @returns {Promise<{files: string[], total: number}>}
 */
export async function writeSitemaps({ dist, siteUrl, groups }) {
  const files = [];
  let total = 0;

  for (const group of groups) {
    // 依網址排序：Map 的走訪順序跟著資料進來的順序跑，排過才保證同一份資料
    // 產出的分檔切點一致，git diff 才看得出真正的變化。
    const entries = group.entries
      .map((e) => ({ ...e, loc: toLoc(siteUrl, e.rel) }))
      .sort((a, b) => (a.loc < b.loc ? -1 : a.loc > b.loc ? 1 : 0));
    if (entries.length === 0) continue;

    const parts = chunk(entries, MAX_URLS_PER_FILE);
    for (const [i, part] of parts.entries()) {
      const name = `sitemap-${group.name}-${i + 1}.xml`;
      const xml = urlsetXml(part);
      const bytes = Buffer.byteLength(xml, 'utf-8');
      if (bytes > MAX_BYTES_PER_FILE) {
        throw new Error(`${name} 未壓縮 ${bytes} bytes，超過協定上限 ${MAX_BYTES_PER_FILE}；請調低 MAX_URLS_PER_FILE`);
      }
      await writeFile(path.join(dist, name), xml, 'utf-8');
      files.push({ name, lastmod: maxDate(part.map((e) => e.lastmod)) });
      total += part.length;
    }
  }

  if (files.length > PROTOCOL_MAX_URLS) {
    throw new Error(`sitemap index 收了 ${files.length} 個 sitemap，超過協定上限 ${PROTOCOL_MAX_URLS}`);
  }

  await mkdir(dist, { recursive: true });
  await writeFile(
    path.join(dist, 'sitemap.xml'),
    indexXml(files.map((f) => ({ ...f, name: `${siteUrl}/${f.name}` }))),
    'utf-8',
  );

  // robots.txt：全站開放檢索，指到 sitemap 的絕對網址（協定要求絕對網址）。
  //
  // /index.json（29,059 筆的前端搜尋索引）刻意不擋，理由：
  //   搜尋頁 /search.html 是純前端，內容整個靠 fetch('/index.json') 生出來。
  //   擋掉它，爬蟲算繪時就拿不到資料，搜尋頁會被當成一個空殼頁——
  //   Google 明確建議不要用 robots.txt 擋算繪需要的資源。
  //   它也不在 sitemap 裡（sitemap 只收 HTML 頁面），本站不主動推它；
  //   內容本身也都已經有 29,059 個課程頁作為正式的可索引版本。
  //   要進一步避免這個 JSON 自己被當結果列出，正解是回 X-Robots-Tag: noindex 標頭，
  //   那是部署端（靜態主機）的設定，不是 robots.txt 管得到的事，這裡不假裝管得到。
  await writeFile(path.join(dist, 'robots.txt'), `# kho.tw — 全台成人課程資訊站
# 全站開放檢索。/index.json 是搜尋頁算繪需要的資料檔，刻意不擋（見 site/sitemap.mjs 註解）。
User-agent: *
Allow: /

Sitemap: ${siteUrl}/sitemap.xml
`, 'utf-8');

  return { files: files.map((f) => f.name), total };
}
