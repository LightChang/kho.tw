// site/validate-jsonld.mjs
// 本機檢查產出頁面裡的 JSON-LD。離線環境沒有 Google 的複合式搜尋結果測試工具，
// 所以自己照規格驗：能不能解析、必要屬性在不在、型別對不對、列舉值合不合法。
//
// 用法：node site/validate-jsonld.mjs [dist 目錄]
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const DIST = process.argv[2] ?? path.resolve(import.meta.dirname, '..', 'dist');

const VALID_AVAILABILITY = new Set([
  'https://schema.org/InStock', 'https://schema.org/SoldOut', 'https://schema.org/PreOrder',
  'https://schema.org/OutOfStock', 'https://schema.org/Discontinued',
]);
const VALID_DAYS = new Set([
  'https://schema.org/Monday', 'https://schema.org/Tuesday', 'https://schema.org/Wednesday',
  'https://schema.org/Thursday', 'https://schema.org/Friday', 'https://schema.org/Saturday',
  'https://schema.org/Sunday',
]);

const LD_RE = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;

function checkCourse(ld, errors, file) {
  const fail = (msg) => errors.push(`${file}：${msg}`);
  if (!ld.name) fail('Course 缺必要屬性 name');
  if (!ld.description) fail('Course 缺必要屬性 description');
  if (ld.description && ld.description.length > 300) fail('description 過長（>300 字）');
  if (!ld.provider) fail('Course 缺建議屬性 provider');
  if (ld.provider && !ld.provider.name) fail('provider 缺 name');
  const offers = [ld.offers, ld.hasCourseInstance?.offers].filter(Boolean);
  for (const o of offers) {
    if (o.availability && !VALID_AVAILABILITY.has(o.availability)) fail(`availability 非合法列舉：${o.availability}`);
    if (o.price !== undefined && typeof o.price !== 'number') fail('price 不是數字');
    if (o.price !== undefined && !o.priceCurrency) fail('有 price 卻缺 priceCurrency');
  }
  const sched = ld.hasCourseInstance?.courseSchedule;
  if (sched) {
    for (const d of sched.byDay ?? []) {
      if (!VALID_DAYS.has(d)) fail(`byDay 非合法列舉：${d}`);
    }
    if (sched.startDate && !/^\d{4}-\d{2}-\d{2}/.test(sched.startDate)) fail(`startDate 格式錯：${sched.startDate}`);
    if (sched.repeatFrequency && !/^P/.test(sched.repeatFrequency)) fail(`repeatFrequency 不是 ISO 8601 duration：${sched.repeatFrequency}`);
  }
  const geo = ld.hasCourseInstance?.location?.geo;
  if (geo && (geo.latitude < 20 || geo.latitude > 27 || geo.longitude < 118 || geo.longitude > 123)) {
    fail(`座標超出臺灣範圍：${geo.latitude},${geo.longitude}`);
  }
}

function checkItemList(ld, errors, file) {
  const fail = (msg) => errors.push(`${file}：${msg}`);
  const items = ld.itemListElement ?? [];
  if (items.length < 3) fail(`ItemList 少於三項（${items.length}），不符合 Course list 規格`);
  items.forEach((item, i) => {
    if (item.position !== i + 1) fail(`ListItem position 不連續（第 ${i + 1} 項為 ${item.position}）`);
    if (!item.url) fail(`第 ${i + 1} 項缺 url`);
    if (item.url && !/^https?:\/\//.test(item.url)) fail(`第 ${i + 1} 項 url 不是絕對網址：${item.url}`);
  });
  const urls = new Set(items.map((i) => i.url));
  if (urls.size !== items.length) fail('ItemList 有重複的 url');
}

async function* htmlFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* htmlFiles(full);
    else if (entry.name.endsWith('.html')) yield full;
  }
}

async function main() {
  const errors = [];
  const counts = { pages: 0, withLd: 0, Course: 0, ItemList: 0, Place: 0, other: 0 };
  for await (const file of htmlFiles(DIST)) {
    counts.pages += 1;
    const html = await readFile(file, 'utf-8');
    const rel = path.relative(DIST, file);
    let found = false;
    for (const m of html.matchAll(LD_RE)) {
      found = true;
      let ld;
      try {
        ld = JSON.parse(m[1]);
      } catch (err) {
        errors.push(`${rel}：JSON-LD 無法解析（${err.message}）`);
        continue;
      }
      if (ld['@context'] !== 'https://schema.org') errors.push(`${rel}：@context 不是 https://schema.org`);
      const type = ld['@type'];
      if (type === 'Course') { counts.Course += 1; checkCourse(ld, errors, rel); }
      else if (type === 'ItemList') { counts.ItemList += 1; checkItemList(ld, errors, rel); }
      else if (type === 'Place') counts.Place += 1;
      else counts.other += 1;
    }
    if (found) counts.withLd += 1;
  }
  process.stderr.write(
    `檢查 ${counts.pages} 頁，其中 ${counts.withLd} 頁有 JSON-LD\n`
    + `Course ${counts.Course}｜ItemList ${counts.ItemList}｜Place ${counts.Place}｜其他 ${counts.other}\n`,
  );
  if (errors.length) {
    const shown = errors.slice(0, 20);
    process.stderr.write(`\n發現 ${errors.length} 個問題，前 ${shown.length} 個：\n${shown.join('\n')}\n`);
    process.exitCode = 1;
  } else {
    process.stderr.write('沒有發現問題\n');
  }
}

await main();
