// site/validate-jsonld.mjs
// 檢查產出頁面（含首頁）裡的 JSON-LD，有錯誤就 exit 1——pnpm run build 與 ops/run-host.sh 都靠這個擋部署。
//
// 兩層檢查：
//   1. 四站共用規則：vendor/seo-ops-jsonld（rules.json 是官方文件查證結果，每條附來源）
//      ＋本站頁型要求 site/jsonld-pages.json（哪一種頁必須／不可有哪些類型）。
//   2. 本站專屬：共用規則沒有、但本站輸出會用到的列舉值與格式（下方 checkCourse／checkItemList）。
//
// 用法：node site/validate-jsonld.mjs [dist 目錄] [--min=warning|info]（預設只列 error 與 warning 摘要）
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  validateHtml, extractJsonLd, filterIssues, formatIssue, loadRules, loadSiteConfig, pagePathFromFile, globToRegExp,
} from '../vendor/seo-ops-jsonld/validate.mjs';

const args = process.argv.slice(2);
const DIST = args.find((a) => !a.startsWith('--')) ?? path.resolve(import.meta.dirname, '..', 'dist');
const MIN = (args.find((a) => a.startsWith('--min=')) ?? '--min=warning').slice(6);
const SITE_CONFIG = path.resolve(import.meta.dirname, 'jsonld-pages.json');

// ── 本站專屬檢查 ─────────────────────────────────────────
const VALID_AVAILABILITY = new Set([
  'https://schema.org/InStock', 'https://schema.org/SoldOut', 'https://schema.org/PreOrder',
  'https://schema.org/OutOfStock', 'https://schema.org/Discontinued',
]);
const VALID_DAYS = new Set([
  'https://schema.org/Monday', 'https://schema.org/Tuesday', 'https://schema.org/Wednesday',
  'https://schema.org/Thursday', 'https://schema.org/Friday', 'https://schema.org/Saturday',
  'https://schema.org/Sunday',
]);

function checkCourse(ld, fail) {
  // 本站政策：description 由 describe() 截到 200 字；provider 在本站一律要有（Google 列為建議）
  if (ld.description && ld.description.length > 300) fail('description 過長（>300 字）');
  if (!ld.provider) fail('Course 缺 provider（本站要求）');
  if (ld.provider && !ld.provider.name) fail('provider 缺 name');
  const offers = [ld.offers, ld.hasCourseInstance?.offers].filter(Boolean);
  for (const o of offers) {
    if (o.availability && !VALID_AVAILABILITY.has(o.availability)) fail(`availability 非合法列舉：${o.availability}`);
    if (o.price !== undefined && typeof o.price !== 'number') fail('price 不是數字');
    if (o.price !== undefined && !o.priceCurrency) fail('有 price 卻缺 priceCurrency');
  }
  const sched = ld.hasCourseInstance?.courseSchedule;
  if (sched) {
    for (const d of sched.byDay ?? []) if (!VALID_DAYS.has(d)) fail(`byDay 非合法列舉：${d}`);
    if (sched.startDate && !/^\d{4}-\d{2}-\d{2}/.test(sched.startDate)) fail(`startDate 格式錯：${sched.startDate}`);
    if (sched.repeatFrequency && !/^P/.test(sched.repeatFrequency)) fail(`repeatFrequency 不是 ISO 8601 duration：${sched.repeatFrequency}`);
  }
  const geo = ld.hasCourseInstance?.location?.geo;
  if (geo && (geo.latitude < 20 || geo.latitude > 27 || geo.longitude < 118 || geo.longitude > 123)) {
    fail(`座標超出臺灣範圍：${geo.latitude},${geo.longitude}`);
  }
}

// site/jsonld.mjs 的 ItemList 一律至少三項（Course list 規格）、position 連續、url 不重複
function checkItemList(ld, fail) {
  const items = ld.itemListElement ?? [];
  if (items.length < 3) fail(`ItemList 少於三項（${items.length}），不符合 Course list 規格`);
  items.forEach((item, i) => {
    if (item.position !== i + 1) fail(`ListItem position 不連續（第 ${i + 1} 項為 ${item.position}）`);
    if (!item.url) fail(`第 ${i + 1} 項缺 url`);
  });
  const urls = new Set(items.map((i) => i.url));
  if (urls.size !== items.length) fail('ItemList 有重複的 url');
}

// BreadcrumbList：position 連續（共用規則只驗必填與項數）
function checkBreadcrumb(ld, fail) {
  (ld.itemListElement ?? []).forEach((item, i) => {
    if (item.position !== i + 1) fail(`麵包屑 position 不連續（第 ${i + 1} 項為 ${item.position}）`);
  });
}

const SITE_CHECKS = { Course: checkCourse, ItemList: checkItemList, BreadcrumbList: checkBreadcrumb };

// ── 主程式 ───────────────────────────────────────────────
async function* htmlFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* htmlFiles(full);
    else if (entry.name.endsWith('.html')) yield full;
  }
}

const rules = await loadRules();
const site = await loadSiteConfig(SITE_CONFIG);
const excluded = (site.exclude ?? []).map(globToRegExp);
const issues = [];
const counts = { pages: 0, withLd: 0 };
const typeCounts = new Map();

for await (const file of htmlFiles(DIST)) {
  const page = pagePathFromFile(DIST, file);
  if (excluded.some((re) => re.test(page))) continue;
  counts.pages += 1;
  const html = await readFile(file, 'utf-8');
  issues.push(...validateHtml(html, { page, rules, site }));
  const blocks = extractJsonLd(html);
  if (blocks.length) counts.withLd += 1;
  for (const b of blocks) {
    for (const item of [b.data].flat()) {
      if (!item || typeof item !== 'object') continue;
      const nodes = Array.isArray(item['@graph']) ? item['@graph'] : [item];
      for (const node of nodes) {
        const type = node['@type'];
        typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
        const check = SITE_CHECKS[type];
        if (check) check(node, (message) => issues.push({ page, block: b.index, type, path: null, code: 'site', severity: 'error', message, source: null }));
      }
    }
  }
}

const errors = filterIssues(issues, 'error');
const shown = filterIssues(issues, MIN);
process.stderr.write(
  `檢查 ${counts.pages} 頁，其中 ${counts.withLd} 頁有 JSON-LD\n`
  + `${[...typeCounts].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`).join('｜')}\n`,
);
if (shown.length) {
  // 依「代碼＋類型」彙總，再列前 20 則原文
  const byKind = new Map();
  for (const i of shown) {
    const k = `[${i.severity}] ${i.code} ${i.type ?? '-'}`;
    byKind.set(k, (byKind.get(k) ?? 0) + 1);
  }
  process.stderr.write(`\n${[...byKind].map(([k, n]) => `${k}：${n}`).join('\n')}\n\n`);
  process.stderr.write(`${shown.slice(0, 20).map(formatIssue).join('\n')}\n`);
}
if (errors.length) {
  process.stderr.write(`\nJSON-LD 錯誤 ${errors.length} 則，不可部署\n`);
  process.exitCode = 1;
} else {
  process.stderr.write(`沒有錯誤（警告 ${filterIssues(issues, 'warning').length} 則）\n`);
}
