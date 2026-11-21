import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cityFacts, soonestOpen } from '../src/lib/city-facts.mjs';

const T = '2026-11-21';
const hasEnded = (c) => Boolean(c.schedule?.endDate) && c.schedule.endDate < T;
const isOpen = (c) => c.enrollment?.status === 'open' && !hasEnded(c);
const kindLabel = new Map([['community-college', '社區大學'], ['sports-center', '運動中心']]);
let i = 0;
const mk = (o = {}) => ({
  slug: `s${i++}`, title: o.title ?? `課${i}`,
  provider: { kind: 'community-college', nameRaw: '甲社大', ...o.provider },
  venue: { city: '臺北市', district: '中正區', ...o.venue },
  schedule: { startDate: '2026-12-01', endDate: '2027-01-31', slots: [{ weekday: 2, startTime: '19:00' }], ...o.schedule },
  enrollment: { status: 'open', ...o.enrollment },
});

test('縣市重點：招生中依單位、還沒開課依月份、行政區依招生中排', () => {
  const list = [
    mk(), mk({ schedule: { startDate: '2027-01-05' } }),
    mk({ provider: { kind: 'sports-center', nameRaw: '乙中心' }, venue: { district: '大安區' }, schedule: { startDate: '2026-10-01' } }),
    mk({ venue: { district: '大安區' }, enrollment: { status: 'full' } }),
    mk({ venue: { district: '大安區' }, schedule: { endDate: '2026-11-01' } }), // 上完了：不算招生中
    mk({ venue: { district: undefined } }),
  ];
  const f = cityFacts({ list, isOpen, hasEnded, today: T, kindLabel });
  assert.equal(f.openN, 4);
  assert.deepEqual(f.byKind.map((k) => [k.label, k.n]), [['社區大學', 3], ['運動中心', 1]]);
  assert.equal(f.notStarted, 3);
  assert.deepEqual(f.startsByMonth, [['2026-12', 2], ['2027-01', 1]]);
  assert.deepEqual(f.districts.map((d) => [d.district, d.open, d.n]), [['中正區', 2, 2], ['大安區', 1, 3]]);
  assert.equal(f.noDistrictOpen, 1);
  assert.equal(f.full, 1);
});

test('最近開課：近的在前、同課不同場次只留一門、同單位最多兩門、兒童課不列', () => {
  const list = [
    mk({ title: '射箭第一場次', provider: { nameRaw: '丙中心' }, schedule: { startDate: '2026-11-22' } }),
    mk({ title: '射箭第二場次', provider: { nameRaw: '丙中心' }, schedule: { startDate: '2026-11-22' } }),
    mk({ title: '兒童游泳班', provider: { nameRaw: '丁中心' }, schedule: { startDate: '2026-11-21' } }),
    mk({ title: 'A', schedule: { startDate: '2026-11-23' } }),
    mk({ title: 'B', schedule: { startDate: '2026-11-24' } }),
    mk({ title: 'C', schedule: { startDate: '2026-11-25' } }), // 甲社大第三門：不列
    mk({ title: 'D', schedule: { startDate: '2026-11-01' } }), // 已開課：不列
  ];
  assert.deepEqual(soonestOpen(list, { isOpen, today: T }).map((c) => c.title), ['射箭第一場次', 'A', 'B']);
});
