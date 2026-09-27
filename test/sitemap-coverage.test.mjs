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
  assert.deepEqual(ok, { notListed: [], noindexListed: [], excludedListed: [], notHtml: [], noindex: 2, excluded: 0 });
  const bad = coverageProblems(onDisk, new Set(['a.html', 'old.html', 'ghost.html']));
  assert.deepEqual(bad.notListed, ['b.html']);
  assert.deepEqual(bad.noindexListed, ['old.html']);
  assert.deepEqual(bad.notHtml, ['ghost.html']);
});

test('排除頁型：講師頁不進 sitemap、進了算錯；講師索引頁照收', async () => {
  const { SITEMAP_EXCLUDED_DIRS, isSitemapExcluded } = await import('../site/sitemap.mjs');
  assert.deepEqual([...SITEMAP_EXCLUDED_DIRS], ['teacher']);
  assert.ok(isSitemapExcluded('teacher/陳清吉-松山社大-3dcef.html'));
  assert.ok(!isSitemapExcluded('teachers.html'));
  assert.ok(!isSitemapExcluded('course/teacher-x.html'));
  const onDisk = new Map([['teachers.html', false], ['teacher/a.html', false], ['course/x.html', false]]);
  const ok = coverageProblems(onDisk, new Set(['teachers.html', 'course/x.html']));
  assert.deepEqual([ok.notListed, ok.excludedListed, ok.excluded], [[], [], 1]);
  const bad = coverageProblems(onDisk, new Set(['course/x.html', 'teacher/a.html']));
  assert.deepEqual(bad.notListed, ['teachers.html']);
  assert.deepEqual(bad.excludedListed, ['teacher/a.html']);
});

test('lastmod 取內容變更日：只有「最後確認日」變了不影響 lastmod；同資料重算結果相同', async () => {
  const { courseChangedAt, courseFirstSeen } = await import('../site/sitemap.mjs');
  const obs = new Map([
    ['a:1', { changed: '2026-09-13', first: '2026-09-12' }],
    ['b:9', { changed: '2026-09-20', first: '2026-09-18' }],
  ]);
  const c = { sources: [{ id: 'a', recordId: '1', lastVerifiedAt: '2026-09-27' }, { id: 'b', recordId: '9', lastVerifiedAt: '2026-09-27' }] };
  assert.equal(courseChangedAt(c, obs), '2026-09-20');
  // 每小時重抓只刷新 lastVerifiedAt：lastmod 不動
  const reverified = { sources: c.sources.map((s) => ({ ...s, lastVerifiedAt: '2026-09-28' })) };
  assert.equal(courseChangedAt(reverified, obs), '2026-09-20');
  assert.equal(courseChangedAt(c, obs), courseChangedAt(structuredClone(c), new Map(obs)));
  assert.equal(courseFirstSeen(c, obs), '2026-09-12');
  // 查不到觀測紀錄才退回最後確認日
  assert.equal(courseChangedAt({ sources: [{ id: 'z', recordId: '0', lastVerifiedAt: '2026-09-27' }] }, obs), '2026-09-27');
});
