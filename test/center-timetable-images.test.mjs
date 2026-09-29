// 圖片課表來源（新莊、中和、五股）：讀圖結果的驗證、各館課表清單的解析、L1 對應。
// 片段取自 2026-09-29 實際頁面，只留解析用得到的標記。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateExtraction } from '../ingest/sources/_vision.mjs';
import { parseWgNews, parseXzDocs, parseZhPostImages, parseZhSwimImages } from '../ingest/sources/center-timetable-images.mjs';
import { normalize } from '../transform/normalize/center-timetable-images.mjs';

const today = new Date('2026-09-29T00:00:00Z');
const row = (o = {}) => ({
  code: 'SK317', title: '兒童班', category: '游泳', section: null, weekdays: [3], startTime: '17:00', endTime: '18:10',
  startDate: '2026-09-09', endDate: '2026-10-14', sessions: 4, price: 1400, teacher: null, place: null,
  audience: '一～九年級', capacityText: '7-10 人', note: '9/2、10/21、10/28 停課', page: 1, ...o,
});

test('讀圖驗證：正常的課表通過', () => {
  const v = validateExtraction({ isTimetable: true, periodStartMonth: '2026-09', periodEndMonth: '2026-10', courses: [row(), row({ code: 'SK319', startTime: '19:00', endTime: '20:10' })] }, { today });
  assert.equal(v.ok, true);
  assert.equal(v.courses.length, 2);
});

test('讀圖驗證：起始日的星期和表上星期多數對不上 → 整份退件', () => {
  // 2026-09-09 是星期三；把星期全讀成二，代表欄位錯位
  const courses = Array.from({ length: 5 }, (_, i) => row({ code: `X${i}`, weekdays: [2] }));
  const v = validateExtraction({ isTimetable: true, periodStartMonth: null, periodEndMonth: null, courses }, { today });
  assert.equal(v.ok, false);
  assert.match(v.errors.join(), /星期對不上 5\/5/);
});

test('讀圖驗證：時間格式、時長、日期離譜的列剔除，太多就整份退件', () => {
  const bad = [row({ code: 'A', startTime: '7:00' }), row({ code: 'B', endTime: '23:50' }), row({ code: 'C', startDate: '2024-09-09' })];
  const v = validateExtraction({ isTimetable: true, periodStartMonth: null, periodEndMonth: null, courses: [row(), ...bad] }, { today });
  assert.equal(v.ok, false);
  assert.equal(v.courses.length, 1);
  assert.equal(v.warnings.length, 3);
});

test('讀圖驗證：不是課表就不能有課', () => {
  assert.equal(validateExtraction({ isTimetable: false, courses: [] }, { today }).ok, true);
  assert.equal(validateExtraction({ isTimetable: false, courses: [row()] }, { today }).ok, false);
  assert.equal(validateExtraction({ courses: [] }, { today }).ok, false);
});

test('新莊：首頁「課程查詢」連到的 Drive 檔與類別名', () => {
  const html = '<a href="https://drive.google.com/file/d/15JNNPNVRsaFnOozxlZBc_7ibjPbfJ47s/view?usp=sharing" target="_blank"><img></a>'
    + '<a href="https://drive.google.com/file/d/15JNNPNVRsaFnOozxlZBc_7ibjPbfJ47s/view?usp=sharing" class="x">課程查詢</a>'
    + '<a href="https://drive.google.com/file/d/15JNNPNVRsaFnOozxlZBc_7ibjPbfJ47s/view?usp=sharing"><span>游泳課程</span></a>'
    + '<a href="https://drive.google.com/file/d/1wi7stPUztLf22TWd6NFq2zoNaqmKhoKR/view?usp=sharing">定期水質檢驗報告</a>';
  assert.deepEqual(parseXzDocs(html), [{ id: '15JNNPNVRsaFnOozxlZBc_7ibjPbfJ47s', label: '游泳課程' }]);
});

test('中和：泳訓課程表圖庫與部落格內文圖', () => {
  const swim = '<h2>泳訓課程表</h2><img src="83e6fd_c3f88b2da01e47a9b1db70247d558db5~mv2.jpg"><img src="83e6fd_c3f88b2da01e47a9b1db70247d558db5~mv2.jpg">'
    + '<h2>泳訓師資</h2><img src="83e6fd_8d1a0c5365304a7a91b7e254ff11eb15~mv2.jpg">';
  assert.deepEqual(parseZhSwimImages(swim), ['83e6fd_c3f88b2da01e47a9b1db70247d558db5~mv2.jpg']);
  const post = '<meta property="og:image" content="83e6fd_d7a68f7ae30a40fe94e31c94e970c903~mv2.jpg">'
    + '<figure class="vscz7" data-hook="figure-IMAGE"><div data-hook="image-viewer"><div id="m7gtx2186"><wow-image id="83e6fd_6211cf7f34df43188e8cae91a0638718~mv2.jpg" class="x">';
  assert.deepEqual(parseZhPostImages(post), ['83e6fd_6211cf7f34df43188e8cae91a0638718~mv2.jpg']);
});

test('五股：最新消息只取課程簡章，不取體驗課與水質', () => {
  const html = '<a href="news.php?pa=getItem&news_id=361" title="blog title">115年11-12月期課出爐囉</a>'
    + '<a href="news.php?pa=getItem&news_id=360" title="blog title">115年10月單月課程</a>'
    + '<a href="news.php?pa=getItem&news_id=329" title="blog title">9、10月單堂體驗課程出爐囉</a>'
    + '<a href="news.php?pa=getItem&news_id=340" title="blog title">115年6月泳池水質抽驗結果</a>';
  assert.deepEqual(parseWgNews(html).map((n) => n.id), ['361', '360']);
});

test('L1：泳訓課靠類別認得出、名額不填、沒寫日期就不填日期', () => {
  const base = { _center: 'wg', _docKey: 'wg:news:361', _docUrl: 'https://wgsc.chanchao.com.tw/news.php?pa=getItem&news_id=361', _periodStartMonth: '2026-11', _periodEndMonth: '2026-12' };
  const [c, dup] = normalize([
    { ...row({ code: 'TH1', title: '幼兒專班', weekdays: [1], startTime: '19:00', endTime: '20:10', startDate: null, endDate: null, sessions: 9, price: 3465, audience: '3-6歲', note: '*每週上課一次' }), ...base },
    { ...row({ code: 'TH1', title: '幼兒專班', weekdays: [1], startDate: null, endDate: null }), ...base },
  ], { fetchedAt: 'x' });
  assert.equal(dup, undefined);
  assert.equal(c._sourceRecordId, 'wg:2026-11:TH1');
  assert.equal(c.categoryRaw, '游泳');
  assert.deepEqual(c.enrollment, { status: 'unknown' });
  assert.equal(c.schedule.startDate, undefined);
  assert.deepEqual(c.schedule.slots, [{ weekday: 1, startTime: '19:00', endTime: '20:10' }]);
  assert.deepEqual(c.term, { raw: '11506', year: 115, termNo: 6 });
  assert.equal(c.price, 3465);
  assert.equal(c.provider.nameRaw, '新北市五股國民運動中心');
  assert.equal(c.location.district, '五股區');
});
