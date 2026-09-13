// transform/normalize/yunlin-cc.mjs
// 雲林縣 4 社大課表 → L1 Course（見 transform/L1-FORMAT.md）
//
// 這支帶得出數字型名額，是名額觀測的來源之一（另有軒恩、臺中聯網、南投）。
// 名額語意（照各校課表頁自己的渲染字樣，不是猜的）：
//   c_UpperLimit  名額上限            → enrollment.capacity
//   c_now         海線渲染成「已繳費N人」，另三校渲染成「目前N人」
//   nonpay        只有海線渲染，字樣是「未繳費N人」
//   full          「額滿」旗標
// 海線的 enrolled 取 c_now + nonpay：兩個數字在該站是並列的兩種名冊狀態，且 106 筆裡
// 「已繳費＋未繳費」沒有任何一筆超過名額上限，符合兩者互斥、都佔位子。另三校沒有 nonpay
// 渲染，c_now 直接就是佔位人數。
//
// 刻意不填的欄位：
//   price／isFree — c_cost 只是學分費／推廣費「其中一項」，詳情頁另列場地費與教材費
//     （實測虎尾溪「草本漢方手作皂」c_cost=800 是學分費，教材費另收 1,950）。填了會低報。
//   enrollment.status 的 open — 課表不回報報名開不開，只有額滿旗標，不能反推「招生中」。
//   FeeLabelName（推廣／一般／五折）是收費類別，不是課程主題，沒有對應欄位就不塞。
const WEEKDAY = { 星期一: 1, 星期二: 2, 星期三: 3, 星期四: 4, 星期五: 5, 星期六: 6, 星期日: 7 };

// p_area 只給鄉鎮名不給後綴。對照表取自 ingest/raw/moe-cc-sites.json 雲林縣據點地址裡
// 出現的 20 個鄉鎮市（實測四校的 p_area 值全部落在這 20 個裡面，無例外）。
const TOWNSHIP = {
  斗六: '斗六市', 斗南: '斗南鎮', 虎尾: '虎尾鎮', 西螺: '西螺鎮', 土庫: '土庫鎮', 北港: '北港鎮',
  古坑: '古坑鄉', 大埤: '大埤鄉', 莿桐: '莿桐鄉', 林內: '林內鄉', 二崙: '二崙鄉', 崙背: '崙背鄉',
  麥寮: '麥寮鄉', 東勢: '東勢鄉', 褒忠: '褒忠鄉', 臺西: '臺西鄉', 台西: '臺西鄉',
  元長: '元長鄉', 四湖: '四湖鄉', 口湖: '口湖鄉', 水林: '水林鄉',
};

const SEASON = [[/秋/, 'autumn'], [/春/, 'spring'], [/暑/, 'summer'], [/寒/, 'winter']];
const CH_NUM = { 一: 1, 二: 2, 三: 3, 四: 4 };
// 第 1 學期＝春季班、第 2 學期＝秋季班（四校皆然：海線 115年第2學期 與山線 115年秋季 同期）
const TERM_SEASON = { 1: 'spring', 2: 'autumn' };

// 同一期別四校四種寫法：「115年第2學期」「115年第二學期」「115-2秋季」「115年秋季」
function parseTerm(raw) {
  const text = (raw ?? '').trim();
  const year = Number(text.match(/(\d{3})/)?.[1]);
  if (!year) return undefined;
  const term = { raw: text, year };
  const season = (SEASON.find(([re]) => re.test(text)) || [])[1];
  if (season) {
    term.season = season;
  } else {
    const nth = text.match(/第\s*([1-4一二三四])\s*學期/)?.[1] ?? text.match(/-\s*([1-4])/)?.[1];
    const no = nth ? (CH_NUM[nth] ?? Number(nth)) : undefined;
    if (TERM_SEASON[no]) term.season = TERM_SEASON[no];
  }
  return term;
}

const toInt = (v) => {
  const n = Number(String(v ?? '').trim());
  return Number.isFinite(n) ? n : undefined;
};
const clean = (v) => String(v ?? '').trim();

export function normalize(records, { fetchedAt }) {
  const out = [];
  for (const r of records) {
    if (!r?.c_sn || !clean(r.c_name)) continue;
    const weekday = WEEKDAY[clean(r.c_week)];
    const slot = {};
    if (weekday) slot.weekday = weekday;
    if (/^\d{1,2}:\d{2}/.test(clean(r.c_StartTime))) slot.startTime = clean(r.c_StartTime);
    if (/^\d{1,2}:\d{2}/.test(clean(r.c_EndTime))) slot.endTime = clean(r.c_EndTime);

    const fullFlag = clean(r.full);          // 「額滿」或空字串
    const stateText = clean(r.c_state);      // 海線才有，實測值為「未開課」
    const statusRaw = [fullFlag, stateText].filter(Boolean).join('／');

    const course = {
      _source: 'yunlin-cc',
      _sourceRecordId: `${r._school}:${r.c_sn}`, // c_sn 只在校內唯一，必須帶學校
      _fetchedAt: fetchedAt,
      title: clean(r.c_name),
      provider: { nameRaw: clean(r._schoolName), kind: 'community-college' },
      schedule: {
        recurrence: 'weekly',
        slots: Object.keys(slot).length ? [slot] : [],
      },
      // 沒有額滿旗標時，來源並未表態報名開不開，維持 unknown
      enrollment: { status: fullFlag ? 'full' : 'unknown' },
      location: { city: '雲林縣' },
      sourceUrl: clean(r._detailUrl),
    };
    if (statusRaw) course.enrollment.statusRaw = statusRaw;
    if (/^\d{4}-\d{2}-\d{2}$/.test(clean(r.c_StartDate))) course.schedule.startDate = clean(r.c_StartDate);
    // 期別來自該校選單標籤（_yearLabel），不是 year 流水號本身
    const term = parseTerm(r._yearLabel);
    if (term) course.term = term;

    // 名額：上限為 0 或缺值時（實測虎尾溪 2 筆）連 capacity 都不填，更不推剩餘
    const capacity = toInt(r.c_UpperLimit);
    const paid = toInt(r.c_now);
    // 海線把名冊拆成已繳費／未繳費兩個數字，兩者都佔位子；另三校只有一個數字
    const unpaid = r._school === 'seacoast' ? (toInt(r.nonpay) ?? 0) : 0;
    const enrolled = paid === undefined ? undefined : paid + unpaid;
    if (capacity !== undefined && capacity > 0) {
      course.enrollment.capacity = capacity;
      if (enrolled !== undefined) {
        course.enrollment.enrolled = enrolled;
        // 額滿旗標優先於相減結果（實測虎尾溪有 c_now > 上限的筆數）
        course.enrollment.available = fullFlag ? 0 : Math.max(0, capacity - enrolled);
        if (course.enrollment.available === 0) course.enrollment.status = 'full';
      }
    } else if (enrolled !== undefined) {
      course.enrollment.enrolled = enrolled;
    }

    const teacher = clean(r.teacher_name);
    if (teacher) course.teachers = [{ nameRaw: teacher }];
    const category = clean(r.ct_name);
    if (category) course.categoryRaw = category; // 學術性／生活藝能／社團性／自主性社團
    // label_name 是社大自己的議題標籤，逗號分隔（例：「親子,新課程」「流域生態」）
    const topics = clean(r.label_name).split(/[,，]/).map((t) => t.trim()).filter(Boolean);
    if (topics.length) course.topicsRaw = topics;
    // c_sn 與教育部全國站 course_url 的 query id 是同一組值（probe 2026-09-13 §1.1），
    // 是 L2 分群 confidence 1.0 的錨點；cluster 的鍵含校名與期別，跨校同號不會誤併
    course.externalIds = { schoolCourseCode: String(r.c_sn) };

    const area = clean(r.p_area);
    const district = TOWNSHIP[area];
    if (district) course.location.district = district;
    const place = clean(r.place_name); // 只有海線有場地名
    if (place) {
      course.location.venueNameRaw = place;
      course.location.addressPrecision = 'venue-name-only';
    } else {
      course.location.addressPrecision = district ? 'district' : 'city';
    }
    out.push(course);
  }
  return out;
}
