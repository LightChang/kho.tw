// transform/normalize/penghu-cc-portal.mjs
// 澎湖縣社區大學「當期課程介紹」 → L1 Course（見 transform/L1-FORMAT.md）
//
// 來源沒有的，一律不填：名額（capacity／available 都沒有）、已報名人數、報名狀態、
// 費用金額、門牌地址。`enrollment.status` 恆為 unknown——頁面連「招生中」都沒寫，
// 拿報名期間（外部 surveycake 表單，115 秋 8/17–8/26）推狀態等於替來源發明資訊。
//
// 教材費用有文字沒有金額（「無償借用曼陀鈴使用(若有毀損須照價賠償)」），所以只填 priceText，
// 不填 price、不判 isFree。
//
// 地點欄是人工填的，實測 49 門有三種寫法，分別對應三種精度（見 parseVenue）。
const WEEKDAY = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7 };
const SEASON = [[/秋/, 'autumn'], [/春/, 'spring'], [/暑/, 'summer'], [/寒/, 'winter']];

const clean = (v) => {
  const s = String(v ?? '').trim();
  return s || undefined;
};

// 「115年秋季班」（課程頁）
function parseTerm(raw) {
  const text = String(raw ?? '').replace(/\s+/g, '');
  const year = Number(text.match(/(\d{3})年/)?.[1]);
  if (!year) return undefined;
  const term = { raw: text, year };
  const season = (SEASON.find(([re]) => re.test(text)) || [])[1];
  if (season) term.season = season;
  return term;
}

// 澎湖縣就六個行政區。上課地點欄的三種寫法（實測 49 門）：
//   「文澳國小教室」只有場館名               → venue-name-only
//   「湖西鄉西溪國小」帶鄉鎮                 → district（鄉鎮是來源寫的，不是猜的）
//   「春鶯藝術工作室(馬公市中華路279號)」
//   「芃芃藝術工作坊 澎湖縣馬公市中央街5號」 → street，門牌拆進 address（7 門）
// 場館名裡沒有鄉鎮就維持 venue-name-only，不從「文澳國小」這種校名反推鄉鎮。
const DISTRICTS = ['馬公市', '湖西鄉', '白沙鄉', '西嶼鄉', '望安鄉', '七美鄉'];

function parseVenue(venueNameRaw) {
  const district = DISTRICTS.find((d) => venueNameRaw.includes(d));
  if (!district) return { venueNameRaw, addressPrecision: 'venue-name-only' };
  // 鄉鎮之後若接得到門牌（「中華路279號」「文康街 38 號」），才算 street
  const tail = venueNameRaw.slice(venueNameRaw.indexOf(district) + district.length);
  const house = tail.match(/^[^()（）]*?\d+\s*號/)?.[0];
  if (!house) return { venueNameRaw, district, addressPrecision: 'district' };
  return {
    venueNameRaw,
    address: `澎湖縣${district}${house}`.replace(/\s+/g, ''),
    district,
    addressPrecision: 'street',
  };
}

// 「18:30-21:30」（週課表）／「週一 18:30 ~ 21:30 共36小時」（課程頁）
function parseSlot(weekdayText, timeText) {
  const weekday = WEEKDAY[String(weekdayText ?? '').match(/[週星期]期?([一二三四五六日])/)?.[1]];
  if (!weekday) return null;
  const m = String(timeText ?? '').match(/(\d{1,2})\s*:\s*(\d{2})\s*[-~～]\s*(\d{1,2})\s*:\s*(\d{2})/);
  if (!m) return { weekday };
  const pad = (h, mi) => `${String(Number(h)).padStart(2, '0')}:${mi}`;
  return { weekday, startTime: pad(m[1], m[2]), endTime: pad(m[3], m[4]) };
}

export function normalize(records, { fetchedAt }) {
  const out = [];
  for (const r of records) {
    if (!r?.courseId) continue;
    const title = clean(r.detailTitle) ?? clean(r.titleText);
    if (!title) continue; // 版面壞掉、連課名都拿不到的那一格就跳過

    const slots = (Array.isArray(r.slotsText) ? r.slotsText : [])
      .map((s) => parseSlot(s?.weekdayText, s?.timeText))
      .filter(Boolean);

    const course = {
      _source: 'penghu-cc-portal',
      _sourceRecordId: String(r.courseId),
      _fetchedAt: fetchedAt,
      title,
      provider: { nameRaw: '澎湖縣社區大學', kind: 'community-college' },
      schedule: { recurrence: 'weekly', slots },
      // 來源完全不回報報名狀態，也沒有名額，不推算
      enrollment: { status: 'unknown' },
      location: { city: '澎湖縣', addressPrecision: 'city' },
      sourceUrl: clean(r.url),
    };
    if (slots.length) course.schedule.sessionsPerWeek = slots.length;

    const term = parseTerm(r.termText);
    if (term) course.term = term;

    // 「週一 18:30 ~ 21:30 共36小時」：總時數是課程頁直給的
    const hours = Number(String(r.detailTimeText ?? '').match(/共\s*(\d+)\s*小時/)?.[1]);
    if (Number.isFinite(hours)) course.schedule.hours = hours;
    const timeInfo = clean(r.detailTimeText);
    if (timeInfo && !slots.length) course.schedule.timeInfoRaw = timeInfo;

    // 課程代碼是社大自己的編碼（LM07、LS02），不是全國站的 internal_course_code，
    // 所以不進 externalIds.schoolCourseCode（那是跨來源合併錨點，混進去會誤配）。
    const code = clean(r.codeText);
    if (code) course.courseCodeRaw = code;

    const category = clean(r.categoryText); // 「生活藝能類/音像藝術」
    if (category) course.categoryRaw = category;
    const audience = clean(r.audienceText);
    if (audience) course.audienceRaw = audience;
    const description = clean(r.goalText);
    if (description) course.description = description;

    // 講師欄可能寫兩位（「黃春鶯 王明吉」「林麗玉 顏秀玲」），拆開存
    const teachers = (clean(r.teacherName) ?? clean(r.teacherText) ?? '')
      .split(/[、,，／/\s]+/).map((t) => t.trim()).filter(Boolean)
      .map((nameRaw) => ({ nameRaw }));
    if (teachers.length) course.teachers = teachers;

    const fee = clean(r.materialFeeText);
    if (fee) course.priceText = `教材費用：${fee}`;

    const venue = clean(r.venueText);
    if (venue) Object.assign(course.location, parseVenue(venue));
    const updated = clean(r.updatedText);
    if (updated) course.sourceUpdatedAt = updated;

    out.push(course);
  }
  return out;
}
