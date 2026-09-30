// 場館頁「這個地點的課程概況」與「同區其他上課地點」的聚合規則（src/lib/venue-profile.mjs）。
// 只聚合課程的公開欄位；這裡的例子確保原文時間只讀明寫的星期＋時刻，不自己推。
import test from 'node:test';
import assert from 'node:assert/strict';
import { slotsOf, daypartOf, yearOf, venueProfile, nearbyVenues, distanceM, fmtDistance } from '../src/lib/venue-profile.mjs';

test('slotsOf：結構化時段優先，沒有才讀原文裡明寫的「星期X HH:MM」', () => {
  assert.deepEqual(slotsOf({ schedule: { slots: [{ weekday: 6, startTime: '19:00' }], timeInfoRaw: '星期一08:00' } }),
    [{ weekday: 6, startTime: '19:00' }]);
  assert.deepEqual(slotsOf({ schedule: { slots: [], timeInfoRaw: '星期六09:00~12:00;13:00~17:00; 星期日9:00-16:00(僅11/22)' } }),
    [{ weekday: 6, startTime: '09:00' }, { weekday: 7, startTime: '09:00' }]);
  // 沒有明確的星期＋時刻就不讀
  assert.deepEqual(slotsOf({ schedule: { slots: [], timeInfoRaw: '平日(週一~週五)上午下午' } }), []);
  assert.deepEqual(slotsOf({}), []);
});

test('daypartOf：12:00 前上午、17:00 起晚上', () => {
  assert.equal(daypartOf('08:30'), '上午');
  assert.equal(daypartOf('12:00'), '下午');
  assert.equal(daypartOf('16:59'), '下午');
  assert.equal(daypartOf('17:00'), '晚上');
  assert.equal(daypartOf(null), null);
});

test('yearOf：開課日優先，沒有才用民國學期', () => {
  assert.equal(yearOf({ schedule: { startDate: '2025-09-01' }, term: { year: 115 } }), 2025);
  assert.equal(yearOf({ term: { year: 114 } }), 2025);
  assert.equal(yearOf({}), null);
});

test('venueProfile：年份、類別、開課單位、時段', () => {
  const list = [
    { category: '工程技術', provider: { nameRaw: 'A 職訓', kind: 'vocational' }, schedule: { startDate: '2026-11-01', slots: [], timeInfoRaw: '星期日09:00-17:00' } },
    { category: '工程技術', provider: { nameRaw: 'A 職訓', kind: 'vocational' }, schedule: { startDate: '2025-03-01', slots: [{ weekday: 6, startTime: '09:00' }] } },
    { category: '語言', provider: { nameRaw: 'B 社大', kind: 'community-college' }, schedule: { startDate: '2026-03-01', slots: [{ weekday: 2, startTime: '19:00' }] } },
    { category: '語言', provider: { nameRaw: 'B 社大', kind: 'community-college' }, schedule: {} },
  ];
  const p = venueProfile(list, { kindLabel: new Map([['vocational', '職業訓練']]) });
  assert.equal(p.total, 4);
  assert.equal(p.span, '2025–2026');
  assert.deepEqual(p.byYear, [['2025', 1], ['2026', 2]]);
  assert.deepEqual(p.categories, [['工程技術', 2], ['語言', 2]]);
  assert.deepEqual(p.providers.map((x) => [x.name, x.kind, x.n, x.span]), [['A 職訓', '職業訓練', 2, '2025–2026'], ['B 社大', null, 2, '2026']]);
  assert.equal(p.timed, 3);
  assert.equal(p.weekend, 2);
  assert.equal(p.weekday, 1);
  assert.deepEqual(p.dayparts, [['上午', 2], ['晚上', 1]]);
});

const page = (id, city, district, lat, lng, n = 1) => ({ venue: { id, city, district, lat, lng }, list: Array(n).fill({}) });

test('nearbyVenues：同縣市同區、依直線距離排，不含自己', () => {
  const self = page('a', '苗栗縣', '竹南鎮', 24.683, 120.880).venue;
  const pages = [
    page('a', '苗栗縣', '竹南鎮', 24.683, 120.880),
    page('far', '苗栗縣', '竹南鎮', 24.70, 120.88),
    page('near', '苗栗縣', '竹南鎮', 24.684, 120.880),
    page('nocoord', '苗栗縣', '竹南鎮', null, null, 9),
    page('other', '苗栗縣', '頭份市', 24.684, 120.880),
  ];
  const r = nearbyVenues(self, pages);
  assert.equal(r.basis, 'district');
  assert.deepEqual(r.rows.map((x) => x.venue.id), ['near', 'far', 'nocoord']);
  assert.equal(r.rows[2].m, null);
});

test('nearbyVenues：沒有行政區就用 3 公里內的同縣市地點；兩者都沒有就不列', () => {
  const self = page('a', '嘉義市', null, 23.4638, 120.4302).venue;
  const pages = [page('same', '嘉義市', '西區', 23.4638, 120.4302), page('5km', '嘉義市', '東區', 23.51, 120.4302), page('b', '嘉義市', null, 23.47, 120.4302)];
  const r = nearbyVenues(self, pages);
  assert.equal(r.basis, 'radius');
  assert.deepEqual(r.rows.map((x) => x.venue.id), ['same', 'b']);
  assert.equal(fmtDistance(r.rows[0].m), '座標相同');
  assert.deepEqual(nearbyVenues({ id: 'x', city: null }, pages).rows, []);
});

test('distanceM／fmtDistance', () => {
  const d = distanceM({ lat: 25.0, lng: 121.5 }, { lat: 25.01, lng: 121.5 });
  assert.ok(d > 1100 && d < 1120, String(d));
  assert.equal(fmtDistance(423), '420 公尺');
  assert.equal(fmtDistance(3000), '3 公里');
  assert.equal(fmtDistance(1449), '1.4 公里');
  assert.equal(fmtDistance(null), '');
});
