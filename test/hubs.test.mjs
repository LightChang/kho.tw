// 需求專題頁的歸類規則（src/lib/hubs.mjs）：決定哪些課進產投、職前、免費、銀髮頁，以及細項頁標題帶不帶運動中心名。
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROGRAMS, isFreeNow, isSenior, splitByCity, byEnrollDeadline, dominantSportsCenter, shortCenter } from '../src/lib/hubs.mjs';

const prog = (key) => PROGRAMS.find((p) => p.key === key).match;

test('職訓方案：看台灣就業通的方案別；mol-6060 沒有方案欄的算職前訓練', () => {
  assert.ok(prog('產投')({ provider: { kind: 'vocational', planRaw: '產業人才投資方案' } }));
  assert.ok(!prog('產投')({ provider: { kind: 'vocational', planRaw: '職前訓練' } }));
  assert.ok(prog('職前訓練')({ provider: { kind: 'vocational', planRaw: '職前訓練' } }));
  assert.ok(prog('職前訓練')({ provider: { kind: 'vocational', planRaw: '區域產業據點計畫(職前)' } }));
  assert.ok(prog('職前訓練')({ provider: { kind: 'vocational' }, sources: [{ id: 'mol-6060' }] }));
  assert.ok(!prog('職前訓練')({ provider: { kind: 'vocational', planRaw: '分署自辦在職訓練' }, sources: [{ id: 'mol-6614' }] }));
});

test('免費：只認來源明寫免費，已截止與停開不列', () => {
  assert.ok(isFreeNow({ isFree: true, enrollment: { status: 'open' } }));
  assert.ok(!isFreeNow({ isFree: true, enrollment: { status: 'closed' } }));
  assert.ok(!isFreeNow({ isFree: true, enrollment: { status: 'cancelled' } }));
  assert.ok(!isFreeNow({ price: undefined, enrollment: { status: 'open' } }));
  assert.ok(!isFreeNow({ isFree: false, enrollment: { status: 'open' } }));
});

test('銀髮：樂齡中心全收；職訓只收高齡者專班；培訓照顧長輩的班不算', () => {
  assert.ok(isSenior({ title: '書法', provider: { kind: 'senior-center' } }));
  assert.ok(isSenior({ title: '銀髮體適能學苑', provider: { kind: 'sports-center' } }));
  assert.ok(isSenior({ title: '【樂齡科技】手機進階應用班', provider: { kind: 'library' }, audienceRaw: '樂齡' }));
  assert.ok(isSenior({ title: '複合式烘焙餐飲實務班(高齡者專班) 第01期', provider: { kind: 'vocational' } }));
  assert.ok(!isSenior({ title: '樂齡健身運動指導員培育班 第01期', provider: { kind: 'vocational' } }));
  assert.ok(!isSenior({ title: '桌遊同樂會', provider: { kind: 'library' }, audienceRaw: '一般,樂齡；無年齡限制' }));
  assert.ok(!isSenior({ title: '瑜珈', provider: { kind: 'community-college' } }));
});

test('splitByCity：未達門檻與沒有縣市的不出頁，多的在前', () => {
  const c = (city) => ({ venue: { city } });
  const out = splitByCity([c('甲'), c('甲'), c('乙'), c('乙'), c('乙'), c(null), c('丙')], 2);
  assert.deepEqual(out.map((x) => [x.city, x.list.length]), [['乙', 3], ['甲', 2]]);
});

test('報名表排序：招生中依截止日、再來尚未開放依開放日', () => {
  const list = [
    { enrollment: { status: 'upcoming', opensAt: '2026-10-05' } },
    { enrollment: { status: 'open', closesAt: '2026-10-20' } },
    { enrollment: { status: 'full' } },
    { enrollment: { status: 'open', closesAt: '2026-10-01' } },
  ].sort(byEnrollDeadline);
  assert.deepEqual(list.map((c) => c.enrollment.closesAt ?? c.enrollment.opensAt ?? c.enrollment.status),
    ['2026-10-01', '2026-10-20', '2026-10-05', 'full']);
});

test('運動中心簡稱與獨佔判斷', () => {
  assert.equal(shortCenter('臺北市內湖運動中心'), '內湖運動中心');
  assert.equal(shortCenter('臺中市太平國民暨兒童運動中心'), '太平運動中心');
  assert.equal(shortCenter('新竹市立竹光國民運動中心'), '竹光運動中心');
  assert.equal(shortCenter('中壢國民運動中心'), '中壢運動中心');
  const sc = (n) => ({ provider: { kind: 'sports-center', nameRaw: n } });
  const cc = { provider: { kind: 'community-college', nameRaw: '內湖社大' } };
  assert.equal(dominantSportsCenter([sc('臺北市內湖運動中心'), sc('臺北市內湖運動中心'), cc]).short, '內湖運動中心');
  assert.equal(dominantSportsCenter([sc('臺北市內湖運動中心'), cc, cc]), null);
});
