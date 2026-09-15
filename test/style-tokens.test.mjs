// 設計系統的硬規則，用測試釘住——口頭約定會在第 20 個頁面失守。
//
//   1. 最小字級 18px，無例外
//   2. 顏色只能用 token 或 oklch()；寫死的 hex 只允許設計系統自己的 fallback 值
//
// tokens.css 是上游同步過來的副本（pnpm run sync:tokens），不在這裡改；
// 但它同步進來的值一樣要守規矩，所以也一起檢查。

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(fileURLToPath(import.meta.url), '..', '..', 'src');
const TOKENS = path.join(SRC, 'styles', 'tokens.css');
const MIN_REM = 1.125;   // 18px

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.(astro|css|mjs)$/.test(e.name)) yield p;
  }
}

async function files() {
  const out = [];
  for await (const f of walk(SRC)) out.push(f);
  return out;
}

const rel = (f) => path.relative(SRC, f);

/** rem / px 字面值換算成 rem，看不懂的回傳 null（例如 var()、%）。 */
function toRem(v) {
  const s = v.trim();
  let m = s.match(/^([\d.]+)rem$/);
  if (m) return Number(m[1]);
  m = s.match(/^([\d.]+)px$/);
  if (m) return Number(m[1]) / 16;
  return null;
}

test('最小字級 18px，無例外', async () => {
  const bad = [];
  for (const f of await files()) {
    const src = await readFile(f, 'utf-8');
    for (const m of src.matchAll(/font-size:\s*([^;}\n]+)/g)) {
      const value = m[1].trim();
      if (value.startsWith('var(--text-')) continue;             // 走 token，值由 tokens.css 保證
      const clamp = value.match(/^clamp\(\s*([^,]+),/);           // clamp 只看下限
      const probe = clamp ? clamp[1] : value;
      const rem = toRem(probe);
      if (rem === null) { bad.push(`${rel(f)}：看不懂的字級 ${value}`); continue; }
      if (rem < MIN_REM) bad.push(`${rel(f)}：${value}＝${(rem * 16).toFixed(0)}px`);
    }
    // JS 端設的 font-size 屬性（例如 d3 的 .style()）
    for (const m of src.matchAll(/['"]font-size['"]\s*,\s*([\d.]+)/g)) {
      if (Number(m[1]) < MIN_REM * 16) bad.push(`${rel(f)}：JS font-size ${m[1]}px`);
    }
  }
  assert.deepEqual(bad, [], `低於 18px 的字級：\n${bad.join('\n')}`);
});

test('tokens.css 的字級量表最小值就是 18px', async () => {
  const src = await readFile(TOKENS, 'utf-8');
  const xs = src.match(/--text-xs:\s*([^;]+);/);
  assert.ok(xs, 'tokens.css 要有 --text-xs');
  assert.equal(toRem(xs[1]), MIN_REM, '--text-xs 必須是 1.125rem＝18px');
});

test('寫死的 hex 只能是設計系統自己的 fallback 值', async () => {
  // oklch() 在舊瀏覽器不支援，tokens.css 用 @supports not 給 hex fallback。
  // 頁面上的 JS 讀不到 CSS 變數時也需要同一組值兜底——但只能用那一組，
  // 隨手挑的 #333 / #666 不行。
  const allowed = new Set(
    (await readFile(TOKENS, 'utf-8')).match(/#[0-9a-fA-F]{6}\b/g)?.map((h) => h.toLowerCase()) ?? []);
  assert.ok(allowed.size > 10, 'tokens.css 應該有一整組 hex fallback');

  const bad = [];
  for (const f of await files()) {
    if (f === TOKENS) continue;
    const src = await readFile(f, 'utf-8');
    for (const m of src.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
      const hex = m[0].toLowerCase();
      if (hex.length !== 7 || !allowed.has(hex)) bad.push(`${rel(f)}：${m[0]}`);
    }
  }
  assert.deepEqual(bad, [], `不在設計系統裡的顏色：\n${bad.join('\n')}`);
});

test('文字顏色不用 --text-muted（白底對比不到 WCAG AA）', async () => {
  // --text-muted 是 L=0.60，白底約 3:1，低於一般文字要求的 4.5:1。
  // 本站讀者是成人與樂齡族群，次要文字一律用 --text-secondary。
  // 非文字的圖形（例如地圖上的圓點）只需要 3:1，所以只擋 CSS 的 color 屬性。
  const bad = [];
  for (const f of await files()) {
    if (f === TOKENS) continue;
    const src = await readFile(f, 'utf-8');
    for (const m of src.matchAll(/(?<![-\w])color:\s*var\(--text-muted\)/g)) bad.push(`${rel(f)}：${m[0]}`);
  }
  assert.deepEqual(bad, [], `用了 --text-muted 當文字顏色：\n${bad.join('\n')}`);
});
