// transform/normalize/ncl-events.mjs
// 國家圖書館活動報名系統 RSS → L1 Course（成人講座、研習課程、展覽導覽那類）
//
// 場館：這是 CONTRACT §4 的場館自營來源，ingest 的 meta.defaultVenue 就是本館地址，
// 直接 import 那份宣告當單一事實來源（ingest 模組的 runAsScript 只在被當 CLI 執行時才動作，
// 這裡 import 不會發出任何請求）。座標 meta 標了 latLngUnverified 且為 null，
// 所以 L1 不寫 lat/lng——地址交給 geocode 流程，由 transform/resolve-relations.mjs 接場館。
//
// 例外：實測 8 筆裡有 3 筆的 description 自己寫了另一個地點
// （多媒體創意實驗中心，臺北市中正區秀山街4號14樓，和本館中山南路20號不同棟）。
// 這種有明寫地點的就用它，沒寫的才落回 defaultVenue——否則會把課掛到錯的門牌上。
//
// 來源沒有的：名額、費用、講師、報名起訖日、期別、上課星期與時刻。
// （部分 description 的自由文字裡有時間與材料費，但格式不固定，不解析、不猜。）
import { meta } from '../../ingest/sources/ncl-events.mjs';

const VENUE = meta?.defaultVenue ?? {};

const clean = (v) => {
  const s = String(v ?? '').trim();
  return s || undefined;
};

const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '').trim()) ? String(v).trim() : undefined);

// 「地點：國家圖書館多媒體創意實驗中心「動漫創作坊」（臺北市中正區秀山街4號14樓）」
// → { venueNameRaw, address }。只認括號裡以縣市開頭、含門牌號的字串，其餘一律不採用。
const COUNTY_RE = /^(臺北市|台北市|新北市|桃園市|臺中市|台中市|臺南市|台南市|高雄市|基隆市|新竹市|嘉義市|新竹縣|苗栗縣|彰化縣|南投縣|雲林縣|嘉義縣|屏東縣|宜蘭縣|花蓮縣|臺東縣|台東縣|澎湖縣|金門縣|連江縣)/;

function venueFromDescription(description) {
  const m = String(description ?? '').match(/地點[：:]\s*([^（(]{2,60})[（(]([^）)]{6,80})[）)]/);
  if (!m) return null;
  const name = m[1].trim();
  const address = m[2].trim();
  if (!COUNTY_RE.test(address) || !/\d+\s*號/.test(address)) return null;
  const city = address.match(COUNTY_RE)?.[0];
  const district = address.slice(city.length).match(/^[^\d]{1,4}?[區鄉鎮市]/)?.[0];
  return { venueNameRaw: name, address, city, district };
}

export function normalize(records, { fetchedAt }) {
  const today = fetchedAt.slice(0, 10);
  const out = [];
  for (const r of records) {
    const link = clean(r.link);
    const title = clean(r.title);
    if (!link || !title) continue;
    // RSS 的 SId 是活動識別碼；link 整串當 id 會因為查詢字串順序變動而不穩定
    const sid = link.match(/SId=([\w-]+)/)?.[1] ?? link;

    const startDate = isoDate(r.startdate);
    const endDate = isoDate(r.enddate);
    const description = clean(r.description);
    const stated = venueFromDescription(description);

    const course = {
      _source: 'ncl-events',
      _sourceRecordId: sid,
      _fetchedAt: fetchedAt,
      title,
      provider: {
        nameRaw: clean(VENUE.name) ?? '國家圖書館',
        kind: 'library',
      },
      schedule: {
        startDate,
        endDate,
        slots: [],
      },
      enrollment: {
        // RSS 不回報報名狀態也沒有報名起訖日。活動結束日已過就是報不到了，
        // 其餘一律 unknown——不要把「活動開始日」當成報名截止日推狀態。
        status: endDate && endDate < today ? 'closed' : 'unknown',
        registerUrl: link,
      },
      location: stated
        ? {
          venueNameRaw: stated.venueNameRaw,
          address: stated.address,
          addressPrecision: 'street',
          city: stated.city,
          district: stated.district,
        }
        : {
          venueNameRaw: clean(VENUE.name),
          address: clean(VENUE.address),
          addressPrecision: clean(VENUE.address) ? 'street' : 'venue-name-only',
          city: clean(VENUE.city),
          district: clean(VENUE.district),
        },
      sourceUrl: link,
    };

    const categoryRaw = clean(r.type); // 專題講座／研習課程／主題展覽
    if (categoryRaw) course.categoryRaw = categoryRaw;
    if (description) course.description = description;
    const updated = clean(r['a10:updated']);
    if (updated) course.sourceUpdatedAt = updated;

    out.push(course);
  }
  return out;
}
