// transform/normalize/nantou-cc-portal.mjs
// 南投縣社區大學聯網 → L1 Course（見 transform/L1-FORMAT.md）
//
// 名額三個數字的來源不同，不要混用：
//   enrolled  ← 即時選課「已選：24」
//   available ← 即時選課「剩餘：11」（直接取用，絕不用 capacity 減 enrolled）
//   capacity  ← 已選＋剩餘；沒有即時數字時才退回詳情頁「招生人數(最高)」
// 為什麼 capacity 不直接用「招生人數(最高)」：那是靜態宣告值，實測 154 門有即時數字的課裡
// 有 3 門和它對不上（書法實作與賞析宣告 24，實際已選 21＋剩餘 10＝31，學校加開了名額）。
// 宣告值當 capacity 會讓同一筆記錄自相矛盾（capacity − enrolled ≠ available）。
// 其餘 151 門兩者相等，等於反覆驗證過這條規則。
// 沒有即時選課資料的課只填 capacity，不推算 available——剩餘名額是首頁「快額滿」的
// 資料來源，寧可空著也不能猜。
//
// 費用欄只有「課程相關費用」（材料費那類），社大的學分費不在這頁，所以只填 priceText、
// 不填 price，也不判 isFree。
const WEEKDAY = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7 };

// "115年度秋季班"
function parseTerm(raw) {
  const text = (raw ?? '').replace(/\s+/g, '');
  const year = Number(text.match(/(\d{3})\s*年度/)?.[1]);
  if (!year) return undefined;
  const term = { raw: text, year };
  const season = [[/秋/, 'autumn'], [/春/, 'spring'], [/暑/, 'summer'], [/寒/, 'winter']]
    .find(([re]) => re.test(text))?.[1];
  if (season) term.season = season;
  return term;
}

// "星期一晚上 18 時 30 分 ~ 21 時 20 分"，同一課可能列多段（以「星期」為界切開）
function parseSlots(timeText, gridWeekdayText) {
  const slots = [];
  const chunks = (timeText ?? '').split(/(?=星期[一二三四五六日])/).filter((c) => /星期/.test(c));
  for (const chunk of chunks) {
    const weekday = WEEKDAY[chunk.match(/星期([一二三四五六日])/)?.[1]];
    if (!weekday) continue;
    const slot = { weekday };
    const t = chunk.match(/(\d{1,2})\s*時\s*(\d{1,2})\s*分\s*~\s*(\d{1,2})\s*時\s*(\d{1,2})\s*分/);
    if (t) {
      const pad = (h, m) => `${String(Number(h)).padStart(2, '0')}:${String(Number(m)).padStart(2, '0')}`;
      slot.startTime = pad(t[1], t[2]);
      slot.endTime = pad(t[3], t[4]);
    }
    slots.push(slot);
  }
  // 詳情頁沒給時間時，退回週課表格線的欄位表頭（那是課排在哪一欄推出來的星期）
  if (slots.length === 0) {
    const weekday = WEEKDAY[(gridWeekdayText ?? '').match(/星期([一二三四五六日])/)?.[1]];
    if (weekday) slots.push({ weekday });
  }
  return slots;
}

const intOf = (s) => {
  const n = Number(String(s ?? '').match(/(\d+)/)?.[1]);
  return Number.isFinite(n) ? n : undefined;
};

export function normalize(records, { fetchedAt }) {
  const out = [];
  for (const r of records) {
    if (!r?.courseId) continue;
    const title = (r.detailTitle || r.title || '').trim();
    if (!title) continue;
    const slots = parseSlots(r.timeText, r.gridWeekdayText);
    const course = {
      _source: 'nantou-cc-portal',
      _sourceRecordId: String(r.courseId),
      _fetchedAt: fetchedAt,
      title,
      provider: {
        nameRaw: (r.schoolName || r.unitName || '').trim(),
        kind: 'community-college',
      },
      schedule: { recurrence: 'weekly', slots },
      enrollment: { status: 'unknown' },
      location: { city: '南投縣', addressPrecision: 'city' },
      sourceUrl: r.url,
    };
    if (r.campusName) course.provider.campusRaw = r.campusName.trim();
    if (slots.length) course.schedule.sessionsPerWeek = slots.length;

    const term = parseTerm(r.detailTermText || r.termText);
    if (term) course.term = term;
    const weeks = intOf(r.weeksText);
    if (weeks !== undefined) course.schedule.weeks = weeks;
    const hours = intOf(r.hoursText);
    if (hours !== undefined) course.schedule.hours = hours;
    // 頁首那句「開課期間:08月31日 至 11月27日…其餘另行公告」是整個校區的通則，
    // 不是這門課的實際首堂日期，所以留原文、不拆成 startDate。
    if (r.periodText) course.schedule.timeInfoRaw = r.periodText.trim();

    // ── 名額 ──
    const declared = intOf(r.capacityText);
    const enrolled = intOf(r.enrolledText);
    const remaining = intOf(r.remainingText);
    if (enrolled !== undefined) course.enrollment.enrolled = enrolled;
    if (remaining !== undefined) course.enrollment.available = remaining;
    const capacity = (enrolled !== undefined && remaining !== undefined)
      ? enrolled + remaining
      : declared;
    if (capacity !== undefined) course.enrollment.capacity = capacity;
    if (r.fullFlag) {
      course.enrollment.status = 'full';
      course.enrollment.available = 0;
    } else if (remaining !== undefined) {
      course.enrollment.status = remaining > 0 ? 'open' : 'full';
    }
    // 「(不開班)」是停開，不是「來源沒回報」，兩者要分開（見 L1-FORMAT.md §2.2）。
    // 這類課即時選課不給名額數字，所以只留 capacity、不填 available。
    if (/不開班|停開|停招|停課/.test(r.immediateText ?? '')) course.enrollment.status = 'cancelled';
    const statusRaw = (r.immediateText ?? '').trim();
    if (statusRaw) course.enrollment.statusRaw = statusRaw;
    if (r.reviewStatusText) course.enrollment.reviewStatusRaw = r.reviewStatusText.trim();

    // ── 內容 ──
    if (r.categoryText) course.categoryRaw = r.categoryText.trim();
    if (r.groupText) course.topicsRaw = [r.groupText.trim()];
    if (r.audienceText) course.audienceRaw = r.audienceText.trim();
    const credit = intOf(r.creditText);
    if (credit !== undefined) course.credit = credit;
    const description = (r.outlineText || r.goalText || '').trim();
    if (description) course.description = description;
    const teachers = (r.teacherText || r.teacher || '')
      .split(/[、,，\s]+/).map((t) => t.trim()).filter(Boolean)
      .map((nameRaw) => ({ nameRaw }));
    if (teachers.length) course.teachers = teachers;
    if (r.feeText) course.priceText = `課程相關費用：${r.feeText.trim()}`;

    // ── 地點 ──
    // 只有教室名（「漳興國小-3-1教室」），沒有門牌；校區名不拿來推鄉鎮，交給地理編碼層。
    const venue = (r.venueText || r.classroom || '').trim();
    if (venue) {
      course.location.venueNameRaw = venue;
      course.location.addressPrecision = 'venue-name-only';
    }
    out.push(course);
  }
  return out;
}
