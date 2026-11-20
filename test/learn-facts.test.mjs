import { test } from 'node:test';
import assert from 'node:assert/strict';
import { learnFacts, factsBlurb, slotKind } from '../src/lib/learn-facts.mjs';

const T = '2026-11-20';
const ended = (c) => Boolean(c.schedule?.endDate) && c.schedule.endDate < T;
const fmt = (n) => Number(n).toLocaleString('en-US');
const mk = (o) => ({ schedule: { slots: [{ weekday: 2, startTime: '10:00' }], endDate: '2026-12-31', ...o.schedule }, enrollment: { status: 'open', ...o.enrollment }, ...o, });

test('時段：週末、平日晚上、平日白天', () => {
  assert.equal(slotKind(mk({ schedule: { slots: [{ weekday: 6, startTime: '09:00' }] } })), 'weekend');
  assert.equal(slotKind(mk({ schedule: { slots: [{ weekday: 3, startTime: '18:30' }] } })), 'evening');
  assert.equal(slotKind(mk({})), 'daytime');
  assert.equal(slotKind(mk({ schedule: { slots: [] } })), null);
});

test('已上完的課不算進「現在」；費用只認來源數字', () => {
  const list = [
    mk({ price: 1200 }), mk({ price: 3000, enrollment: { status: 'full' } }), mk({ isFree: true, price: 0 }),
    mk({}), mk({ price: 9999, schedule: { endDate: '2026-01-01' } }),
    mk({ enrollment: { status: 'upcoming', opensAt: '2026-12-01' } }),
  ];
  const f = learnFacts(list, ended, T);
  assert.equal(f.total, 6);
  assert.equal(f.current, 5);
  assert.equal(f.open.length, 3);
  assert.deepEqual(f.price, { min: 1200, max: 3000, median: 2100, n: 2 });
  assert.equal(f.free, 1);
  assert.equal(f.unpriced, 2);
  assert.equal(f.nextOpensAt, '2026-12-01');
  assert.match(factsBlurb(f, fmt), /有標價的 2 門 1,200–3,000 元，免費 1 門/);
});

test('頁首的招生中門數與「先看重點」同一個定義（上完的課不算招生中）', async () => {
  const { isOpen, hasEnded, TODAY } = await import('../src/lib/data.mjs');
  const past = '2000-01-01';
  const list = [
    mk({ schedule: { endDate: '2999-12-31' } }),
    mk({ schedule: { endDate: past } }),                      // 來源仍寫 open，但已上完
    mk({ schedule: { endDate: undefined } }),                // 沒有結束日：算還沒上完
    mk({ enrollment: { status: 'full' }, schedule: { endDate: '2999-12-31' } }),
  ];
  const f = learnFacts(list, hasEnded, TODAY);
  assert.equal(list.filter(isOpen).length, 2);
  assert.equal(f.open.length, list.filter(isOpen).length);
});
