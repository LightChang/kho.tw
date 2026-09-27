// sitemap 與 noindex 的一致性（site/sitemap.mjs 的 hasNoindex／coverageProblems，check-sitemap.mjs 用）。
// 規則：可收錄的頁必須全進 sitemap；noindex 的頁一律不得進 sitemap。
import test from 'node:test';
import assert from 'node:assert/strict';
import { hasNoindex, coverageProblems } from '../site/sitemap.mjs';

test('hasNoindex：只認 <head> 裡的 robots meta', () => {
  assert.ok(hasNoindex('<head><meta name="robots" content="noindex,follow"></head><body></body>'));
  assert.ok(hasNoindex("<head><meta content='noindex' name='robots'></head>"));
  assert.ok(hasNoindex('<head><meta name="robots" content="follow, noindex"></head>'));
  assert.ok(!hasNoindex('<head><meta name="description" content="noindex"></head>'));
  assert.ok(!hasNoindex('<head><meta name="robots" content="index,follow"></head>'));
  assert.ok(!hasNoindex('<head></head><body><meta name="robots" content="noindex"></body>'));
  assert.ok(!hasNoindex('<head><title>x</title></head>'));
});

test('coverageProblems：可收錄必須在、noindex 必須不在、sitemap 不可指向不存在的頁', () => {
  const onDisk = new Map([['a.html', false], ['b.html', false], ['old.html', true], ['old2.html', true]]);
  const ok = coverageProblems(onDisk, new Set(['a.html', 'b.html']));
  assert.deepEqual(ok, { notListed: [], noindexListed: [], notHtml: [], noindex: 2 });
  const bad = coverageProblems(onDisk, new Set(['a.html', 'old.html', 'ghost.html']));
  assert.deepEqual(bad.notListed, ['b.html']);
  assert.deepEqual(bad.noindexListed, ['old.html']);
  assert.deepEqual(bad.notHtml, ['ghost.html']);
});
