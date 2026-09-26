// 結束日早於開始日的回歸測試（2026-09：北市社大 120 門卡片誤標「已結束」）。
// 例子全部取自實際資料。
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClusters } from '../transform/cluster.mjs';
import { project } from '../transform/emit.mjs';
import { normalize as normalizeTaipeiCc } from '../transform/normalize/taipei-cc.mjs';
import { dropInvertedEndDates } from '../transform/normalize.mjs';
import { isInvertedSchedule } from '../transform/_date.mjs';

const provider = { kind: 'community-college', nameRaw: '臺北市士林社區大學' };
const slots = [{ endTime: '22:00', startTime: '19:00', weekday: 5 }];
// 士林社大「肌力訓練與滾筒放鬆」：課程代碼 H14 跨期沿用。北市聯網給的是 115 秋季班，
// 教育部兩支給的是 115 春季班。
const observations = [
  {
    id: 'taipei-cc:69e2057e293b2c3358ca5cc5',
    payload: {
      _source: 'taipei-cc', _sourceRecordId: '69e2057e293b2c3358ca5cc5', title: '肌力訓練與滾筒放鬆',
      provider, teachers: [{ nameRaw: '黃宸力' }],
      term: { raw: '115年度秋季班', season: 'autumn', year: 115 },
      schedule: { recurrence: 'weekly', slots, startDate: '2026-09-04' },
      externalIds: { schoolCourseCode: 'H14' },
    },
  },
  {
    id: 'moe-cc-courses:300212',
    payload: {
      _source: 'moe-cc-courses', _sourceRecordId: '300212', title: '肌力訓練與滾筒放鬆',
      provider, teachers: [{ nameRaw: '鍾坤樺(阿坤)' }],
      term: { raw: '1151', season: 'spring', year: 115 },
      schedule: { endDate: '2026-07-03', recurrence: 'weekly', slots, startDate: '2026-03-06' },
    },
  },
  {
    id: 'moe-cc-detail:300212',
    payload: {
      _source: 'moe-cc-detail', _sourceRecordId: '300212', title: '肌力訓練與滾筒放鬆',
      provider, teachers: [{ nameRaw: '鍾坤樺(阿坤)' }],
      term: { raw: '1151', season: 'spring', year: 115 },
      schedule: { endDate: '2026-07-03', recurrence: 'weekly', slots, startDate: '2026-03-06' },
      externalIds: { schoolCourseCode: 'H14' },
    },
  },
];

test('同一課程代碼、不同期別的班不合併成同一門課', async () => {
  const clusters = await buildClusters(observations);
  const ofTaipei = clusters.find((c) => c.members.some((m) => m.source === 'taipei-cc'));
  assert.deepEqual(ofTaipei.members.map((m) => m.source), ['taipei-cc']);
  // 同期的兩支教育部來源仍然合併
  const ofMoe = clusters.find((c) => c.members.some((m) => m.source === 'moe-cc-courses'));
  assert.deepEqual(ofMoe.members.map((m) => m.source).sort(), ['moe-cc-courses', 'moe-cc-detail']);
});

test('分群後投影出來的課表，結束日不早於開始日', async () => {
  const clusters = await buildClusters(observations);
  const byId = new Map(observations.map((o) => [o.id, o]));
  for (const c of clusters) {
    const course = project(c, c.members.map((m) => byId.get(m.observationId)));
    assert.equal(isInvertedSchedule(course.schedule), false, `${c.id} ${JSON.stringify(course.schedule)}`);
  }
});

test('不同期的成員不能經由沒有期別的成員橋接起來', async () => {
  const noTerm = {
    id: 'moe-cc-detail:000000',
    payload: { ...observations[2].payload, _sourceRecordId: '000000', term: undefined },
  };
  const clusters = await buildClusters([...observations, noTerm]);
  const ofTaipei = clusters.find((c) => c.members.some((m) => m.source === 'taipei-cc'));
  assert.ok(!ofTaipei.members.some((m) => m.source === 'moe-cc-courses'));
});

test('來源本身結束日早於開始日時，normalize 拿掉 endDate', () => {
  // 北市聯網明德國小「藝術欣賞與創作班」
  const [course] = normalizeTaipeiCc([{
    _id: '6a0bbe414e00243ab245bcc8', name: '藝術欣賞與創作班', school: '明德國小',
    startDate: '2026-09-01T00:00:00.000+08:00', endDate: '2026-06-12T00:00:00.000+08:00',
    semester: '115年度第1期',
  }], { fetchedAt: '2026-09-26T00:00:00Z' });
  assert.equal(isInvertedSchedule(course.schedule), true);
  const dropped = dropInvertedEndDates([course]);
  assert.equal(dropped.length, 1);
  assert.equal(course.schedule.endDate, undefined);
  assert.equal(course.schedule.startDate, '2026-09-01');
});
