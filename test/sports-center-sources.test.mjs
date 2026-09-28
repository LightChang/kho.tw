// 運動中心三支來源的解析：軒恩各站自編類別代碼、長佳清單的名額、全越的狀態碼。
// 片段取自 2026-09-28 實際回應，只留解析用得到的標記。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCategories } from '../ingest/sources/xuanen-centers.mjs';
import { parseCourses, parseSites } from '../ingest/sources/changjia-centers.mjs';
import { normalize as normChangjia } from '../transform/normalize/changjia-centers.mjs';
import { normalize as normTeamx } from '../transform/normalize/teamxports-centers.mjs';

test('軒恩：類別代碼讀該站自己的 radio，不沿用中山那組', () => {
  const html = '<input id="ContentPlaceHolder1_rbn_2_0" type="radio" name="ctl00$ContentPlaceHolder1$rbn_2" value="21" checked="checked" />'
    + '<label for="ContentPlaceHolder1_rbn_2_0">有氧系列課程</label>'
    + '<input id="ContentPlaceHolder1_rbn_2_1" type="radio" name="ctl00$ContentPlaceHolder1$rbn_2" value="53" />'
    + '<label for="ContentPlaceHolder1_rbn_2_1">泳池-團體班課程</label>'
    + '<input id="ContentPlaceHolder1_rbn_1_0" type="radio" name="ctl00$ContentPlaceHolder1$rbn_1" value="全部" />';
  assert.deepEqual(parseCategories(html), [
    { code: 21, name: '有氧系列課程' },
    { code: 53, name: '泳池-團體班課程' },
  ]);
});

const CJ_BLOCK = `<div class='listSectionIcon2'  onclick = "x">
  <div class='listSectionIconTextTop2'><label>115_05兒童週六假日班15:00B(7~12歲)(9/26、10/10、10/24停課)</label></div>
  <div class='listSectionIconTextSec2' ><label>新北市新店國民運動中心-1F泳池</label></div>
  <div class='listSectionIconTextThird2'><label>報名狀況: (8/10) </label></div>
  <div class='listSectionIconText4th2'><label>$1750/5堂</label></div>
</div>
<form id = 'form_EBFC58F7-0DFD-4AD6-9D32-0712E936CE24' method='post' action='Course/index.php?LID=XDSC&amp;CCID=EBFC58F7-0DFD-4AD6-9D32-0712E936CE24&amp;CategoryID=CCC_CJ_Swimming&amp;weekDay=' style='display: none;'></form>`;

test('長佳：清單的 (已報名/名額) 換成剩餘名額，期別與時刻取自課名', () => {
  const [row] = parseCourses(CJ_BLOCK);
  assert.equal(row.enrolled, 8);
  assert.equal(row.capacity, 10);
  const [c] = normChangjia([{
    ...row, weekDays: [6], _lid: 'XDSC', _site: '新北市新店國民運動中心',
    _address: '231新北市新店區北新路一段88巷12號', _categoryId: 'CCC_CJ_SWIMMING', _categoryName: '游泳',
  }], { fetchedAt: 'x' });
  assert.equal(c.title, '115_05兒童週六假日班15:00B(7~12歲)(9/26、10/10、10/24停課)');
  assert.deepEqual(c.enrollment, { status: 'open', statusRaw: '報名狀況 (8/10)', capacity: 10, available: 2 });
  assert.deepEqual(c.schedule.slots, [{ weekday: 6, startTime: '15:00' }]);
  assert.deepEqual(c.term, { raw: '115_05', year: 115, termNo: 5 });
  assert.equal(c.location.address, '新北市新店區北新路一段88巷12號');
  assert.equal(c.price, 1750);
});

test('長佳：首頁表單列出各館', () => {
  const html = "<form id='XDSCForm' action='Location/' method='post'><input type='hidden' name='LID' value='XDSC'>"
    + "<input type='hidden' name='LIDName' value='新北市新店國民運動中心'><input type='hidden' name='address' value='231新北市新店區北新路一段88巷12號'></form>";
  assert.deepEqual(parseSites(html), [{ lid: 'XDSC', name: '新北市新店國民運動中心', address: '231新北市新店區北新路一段88巷12號' }]);
});

test('全越：剩餘 0 一律額滿，其餘照前端 getButtonLabel 的狀態碼；不收教師', () => {
  const base = {
    id: 1, title: 'Zumba(SX)', number: 'A120B', startDate: '2026-09-07', endDate: '2026-10-26',
    regStartDate: '2026-08-03T00:00:00', regEndDate: '2026-10-31T00:00:00', week: ['一'],
    startTime: '20:10:00', endTime: '21:00:00', courtTitles: ['有氧教室B / 2 有氧教室B'],
    teacherName: '軍皓', nickname: '林軍皓', price: 1440, capacityMax: 25, signedUpCount: 4, avaliableCount: 21,
    _siteId: 7, _siteTitle: '新北市三峽國民運動中心', _siteHost: 'sx.teamxports.com',
    _siteAddress: '新北市三峽區文化路210巷12號', _categoryName: '有氧類',
  };
  const [open, full, early] = normTeamx([
    { ...base, enrollmentStatus: 0 },
    { ...base, id: 2, enrollmentStatus: 0, avaliableCount: 0, signedUpCount: 25 },
    { ...base, id: 3, enrollmentStatus: 1 },
  ], { fetchedAt: 'x' });
  assert.equal(open.enrollment.status, 'open');
  assert.equal(open.enrollment.available, 21);
  assert.equal(full.enrollment.status, 'full');
  assert.equal(early.enrollment.status, 'upcoming');
  assert.equal(open.teachers, undefined);
  assert.deepEqual(open.schedule.slots, [{ weekday: 1, startTime: '20:10', endTime: '21:00' }]);
  assert.equal(open.enrollment.closesAt, '2026-10-31T00:00:00+08:00');
  assert.equal(open.location.city, '新北市');
  assert.equal(open.location.district, '三峽區');
  assert.equal(open.location.address, undefined);
});
