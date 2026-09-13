// transform/normalize/taiwanjobs.mjs
// 台灣就業通職訓課程 → L1 Course（見 transform/L1-FORMAT.md）
// 它匯總職前訓練、分署自辦在職、產業人才投資方案等七類，PlanName 就是方案名稱。
const dateOnly = (s) => (s ? String(s).slice(0, 10) : undefined);

// 實測 2026-09-12：有地址的 2286 筆全部以縣市開頭，所以不需要補 CityName；
// 但其中 137 筆來源自己就把縣市寫了兩次（「嘉義市嘉義市垂楊路508號5樓之2」），要收斂掉。
const COUNTY_RE = /^(臺北市|台北市|新北市|桃園市|臺中市|台中市|臺南市|台南市|高雄市|基隆市|新竹市|嘉義市|新竹縣|苗栗縣|彰化縣|南投縣|雲林縣|嘉義縣|屏東縣|宜蘭縣|花蓮縣|臺東縣|台東縣|澎湖縣|金門縣|連江縣)/;
const dedupeCounty = (addr) => addr.replace(/^(..[市縣])\1+/, '$1');

// ⚠️ 實測 2026-09-12：列表端點的 THOURS、TNUM 恆為 0，DEFSTDCOST／DEFGOVCOST 恆為 null。
// 訓練時數、招訓人數、學費要從 Url 指的單筆詳情頁取，或改用開放資料 6060 的「經費」欄位
// （格式「學員負擔：0.0000;政府負擔：22204.0000」）。下面的對應留著，等哪天來源補值就會生效。
// 費用欄位是分開的兩個數字：學員負擔 DEFSTDCOST、政府負擔 DEFGOVCOST
function priceOf(r) {
  const n = Number(r.DEFSTDCOST);
  return Number.isFinite(n) && r.DEFSTDCOST !== null && r.DEFSTDCOST !== '' ? n : undefined;
}

// 報名狀態來源只給起訖日，用抓取日推。邊界日翻轉是真實變化，contentHash 跟著變是預期的。
function statusOf(r, today) {
  const open = dateOnly(r.RegisterStartDateTime);
  const close = dateOnly(r.RegisterEndDateTime);
  if (close && close < today) return 'closed';
  if (open && open > today) return 'upcoming'; // 報名尚未開始，和「來源不回報」是兩件事
  if (open && close) return 'open';
  return 'unknown';
}

export function normalize(records, { fetchedAt }) {
  const today = fetchedAt.slice(0, 10);
  const out = [];
  for (const r of records) {
    if (!r?.ID || !r.Name) continue;
    const address = dedupeCounty((r.Address ?? '').trim());
    const course = {
      _source: 'taiwanjobs',
      _sourceRecordId: r.ID,
      _fetchedAt: fetchedAt,
      title: r.Name.trim(),
      provider: {
        nameRaw: (r.TrainingUnit ?? '').trim(),
        kind: 'vocational',
        operatorRaw: r.BranchName || undefined,
        planRaw: r.PlanName || undefined,
      },
      schedule: {
        startDate: dateOnly(r.TrainingStartDateTime),
        endDate: dateOnly(r.TrainingEndDateTime),
        recurrence: 'irregular', // 職訓是連續密集班，不是每週一次
        slots: [],
      },
      enrollment: { status: statusOf(r, today) },
      location: {
        addressPrecision: address ? (/\d+\s*號|\d+樓/.test(address) ? 'street' : 'district') : 'city',
      },
    };
    if (r.TrainingTime) course.schedule.timeInfoRaw = String(r.TrainingTime).trim();
    if (Number(r.THOURS) > 0) course.schedule.hours = Number(r.THOURS);
    if (r.Category) course.categoryRaw = r.Category;
    if (r.CityName) course.location.city = r.CityName;
    if (address) {
      course.location.venueNameRaw = address;
      if (/\d+\s*號|\d+樓/.test(address)) {
        course.location.address = COUNTY_RE.test(address) || !r.CityName
          ? address
          : `${r.CityName}${address}`;
      }
    } else if (r.CourseLocation) {
      course.location.venueNameRaw = r.CourseLocation;
    }
    const opens = dateOnly(r.RegisterStartDateTime);
    const closes = dateOnly(r.RegisterEndDateTime);
    if (opens) course.enrollment.opensAt = opens;
    if (closes) course.enrollment.closesAt = closes;
    if (Number(r.TNUM) > 0) course.enrollment.capacity = Number(r.TNUM);
    if (r.Url) course.enrollment.registerUrl = r.Url;
    const price = priceOf(r);
    if (price !== undefined) {
      course.price = price;
      course.isFree = price === 0;
    }
    if (r.SourcePrimaryKey) course.externalIds = { taiwanjobs: String(r.SourcePrimaryKey) };
    if (r.Url) course.sourceUrl = r.Url;
    if (r.UpdateTime) course.sourceUpdatedAt = r.UpdateTime;
    out.push(course);
  }
  return out;
}
