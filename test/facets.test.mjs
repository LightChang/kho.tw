// 細項、證照班、門牌地點的判斷規則（src/lib/facets.mjs）。
// 這些規則決定哪些頁面存在、標題寫什麼，改規則時先看這裡的例子有沒有被改壞。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compileActivities, activitiesOf, isCert, isBareAddress, shortCity, shortDistrict, venueDisplay, seasonOf,
} from '../src/lib/facets.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..');
const rules = JSON.parse(await readFile(path.join(ROOT, 'overrides', 'activities.json'), 'utf-8'));
const acts = compileActivities(rules);
const namesOf = (title) => activitiesOf({ title }, acts).map((a) => a.name);

test('activities.json：名稱不重複、大類都在 taxonomy 裡、正規表示式編得過', async () => {
  const taxonomy = JSON.parse(await readFile(path.join(ROOT, 'overrides', 'taxonomy.json'), 'utf-8'));
  const names = rules.activities.map((a) => a.name);
  assert.equal(new Set(names).size, names.length);
  for (const a of rules.activities) {
    assert.ok(taxonomy.categories.includes(a.topic), `${a.name} 的 topic「${a.topic}」不在 taxonomy.json`);
    // 名稱會變成網址的一段，不能有斜線
    assert.ok(!/[/\\?#]/.test(a.name), `${a.name} 不能當網址`);
  }
});

test('細項：常見課名歸到對的細項', () => {
  assert.ok(namesOf('器械皮拉提斯').includes('皮拉提斯'));
  assert.ok(namesOf('器械皮拉提斯').includes('器械皮拉提斯'));
  assert.ok(namesOf('空中瑜伽').includes('瑜珈'));
  assert.ok(namesOf('拳擊有氧-B').includes('拳擊'));
  assert.ok(namesOf('增肌減脂訓練班').includes('肌力訓練'));
  assert.ok(namesOf('居家水電維修DIY').includes('水電'));
  assert.ok(namesOf('成人芭蕾基礎').includes('芭蕾'));
  assert.ok(namesOf('頌缽療癒').includes('頌缽'));
  assert.deepEqual(namesOf('日本有氧太鼓(初級)').includes('有氧運動'), false);
  assert.deepEqual(namesOf('MAIN STREET 英文'), ['英語']);
});

test('細項：運動中心泳訓課課名沒寫游泳時，看來源類別', () => {
  const of = (title, categoryRaw) => activitiesOf({ title, categoryRaw }, acts).map((a) => a.name);
  assert.ok(of('05期兒童班', '泳訓團體').includes('游泳'));
  assert.ok(of('成人團體課程', '泳池-團體班課程').includes('游泳'));
  assert.ok(of('兒童初階班', '游泳').includes('游泳'));
  assert.deepEqual(of('兒童初階班', '球類課程').includes('游泳'), false);
  // 沒有 categoryMatch 的細項不看類別：類別叫「瑜珈系列」不代表課名寫的是瑜珈
  assert.deepEqual(of('拉丁爵士', '瑜珈系列').includes('瑜珈'), false);
});

test('證照班：看課名與描述，結業證書不算', () => {
  assert.ok(isCert({ title: '中餐烹調丙級' }));
  assert.ok(isCert({ title: '堆高機操作人員訓練班第02期' }));
  assert.ok(isCert({ title: '租賃住宅管理人員訓練班第12期' }));
  assert.ok(isCert({ title: '電工', description: '就業展望：輔導技術士技能檢定：丙級室內配線' }));
  assert.ok(!isCert({ title: '水彩畫', description: '全勤者頒發結業證書' }));
  assert.ok(!isCert({ title: '快樂學二胡' }));
});

test('門牌地點：只有地址的名稱才算', () => {
  assert.ok(isBareAddress('苗栗縣竹南鎮福德路1號'));
  assert.ok(isBareAddress('桃園區信光路55號'));
  assert.ok(isBareAddress('雲林縣古坑鄉荷苞厝8號'));
  assert.ok(isBareAddress('苗栗縣三義鄉雙潭村106之2號'));
  assert.ok(!isBareAddress('臺北市士林區公民教室：承德路4段190號'));
  assert.ok(!isBareAddress('吉安國中體育館--花蓮縣吉安鄉中山路3段662號'));
  assert.ok(!isBareAddress('臺北市內湖運動中心'));
});

test('門牌地點的標題：用開課單位補，不自己編地名；人工對照優先', () => {
  const v = { id: 'ven_x', name: '苗栗縣竹南鎮福德路1號' };
  const list = [1, 2, 3].map(() => ({ provider: { nameRaw: '某某職業訓練中心' } }));
  assert.equal(venueDisplay(v, list).heading, '苗栗縣竹南鎮福德路1號（某某職業訓練中心上課地點）');
  assert.equal(venueDisplay(v, list, { ven_x: { name: '某某大樓' } }).heading, '某某大樓（苗栗縣竹南鎮福德路1號）');
  assert.equal(venueDisplay({ id: 'y', name: '臺北市內湖運動中心' }, list).heading, '臺北市內湖運動中心');
});

test('地名口語寫法與學期', () => {
  assert.equal(shortCity('桃園市'), '桃園');
  assert.equal(shortCity('臺中市'), '台中');
  assert.equal(shortCity('嘉義縣'), '嘉義縣');
  assert.equal(shortDistrict('內湖區'), '內湖');
  assert.equal(shortDistrict('東區'), '東區');
  assert.equal(seasonOf('2026-09-02'), '2026 秋季');
  assert.equal(seasonOf('2026-03-01'), '2026 春季');
});

test('課程頁標題：補學期，單位看不出縣市時補縣市，撞名才補時段', async () => {
  const { courseTitle, courseSeriesKey } = await import('../src/lib/facets.mjs');
  const wd = ['', '週一', '週二', '週三', '週四', '週五', '週六', '週日'];
  const base = { title: '日語生活會話', provider: { nameRaw: '臺中市北屯社區大學' }, venue: { city: '臺中市' },
    schedule: { startDate: '2026-09-07', slots: [{ weekday: 6, startTime: '19:00' }] } };
  assert.equal(courseTitle(base), '日語生活會話｜臺中市北屯社區大學 2026 秋季');
  assert.equal(courseTitle(base, { collide: true, weekdayLabel: wd }), '日語生活會話｜臺中市北屯社區大學 2026 秋季 週六 19:00');
  assert.equal(courseTitle({ ...base, provider: { nameRaw: '大安社區大學' }, venue: { city: '臺北市' } }), '日語生活會話｜大安社區大學（台北） 2026 秋季');
  assert.equal(courseTitle({ title: '書法', provider: { nameRaw: '某協會' } }), '書法｜某協會');
  // 同一門課的不同期數算同一系列
  assert.equal(courseSeriesKey({ title: '堆高機操作人員訓練班第02期', provider: { nameRaw: 'x' } }),
    courseSeriesKey({ title: '堆高機操作人員訓練班 第3期', provider: { nameRaw: 'x' } }));
});
