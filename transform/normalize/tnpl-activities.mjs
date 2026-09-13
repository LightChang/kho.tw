// transform/normalize/tnpl-activities.mjs
// 臺南市立圖書館活動報名 API → L1 Course（見 transform/L1-FORMAT.md）
//
// ── 一個場次一筆 ──
// 來源是兩層結構（主活動 → 場次），但報名、名額、時間、地點全都掛在**場次**上，
// 同一個主活動的不同場次可能差好幾週、名額也不同。所以攤平成一場次一筆。
// `_sourceRecordId` = 主活動 id ＋ 場次序號（`za…#0`）。主活動 id 取自
// 「主活動資訊網址暨報名連結」路徑中的 `za…` 片段（實測 49 筆全部取得到、且兩兩不重複）。
// 序號會隨場次增刪位移，這是這個來源沒有給場次 id 之下能有的最穩定鍵。
//
// ── 名額（CONTRACT §5）──
// 只填 `capacity`，**不填 `available`**。來源的 `可報名數` 是總名額不是剩餘：
// 同一場次活動頁寫「正取人數： 5 / 20」而 API 回 20（見 ingest 檔頭的查證紀錄）。
// 來源沒有給已報名人數，剩餘名額算不出來，照 §5 留白——寧可沒有，也不要假的倒數。
//
// ── 狀態 ──
// 開放報名中→open、報名尚未開始→upcoming、報名截止→closed。
// 實測 89 個場次只出現這三種值；「額滿」規則一併寫上以防來源日後新增。
//
// ── 地點與座標 ──
// 來源的「活動地點」是館內位置（`B1五感探索區`），沒有門牌；館別在「主辦單位」。
// 座標與地址一律查 `ingest/raw/national-public-libraries.json`（公共圖書館基本資料名錄），
// 對不到就不填，**不推測**（CONTRACT §4）。實測 18 個館別全部對得到（15 個靠後綴比對、
// 3 個靠下面的別名表）。
import { readFileSync } from 'node:fs';
import path from 'node:path';

// 名錄的館名比來源多了縣市（有時還多了行政區）前綴，例：
// 來源「裕文圖書館」→ 名錄「臺南市東區裕文圖書館」。後綴比對可解掉大多數，
// 剩下三個總館／文化中心的寫法差太多，列別名表（右側都是名錄裡實際存在的字串）。
const ALIAS = {
  '市圖總館(新總館)': '臺南市立圖書館(新總館)',
  '市圖總館(公園總館)': '臺南市立圖書館(公園總館)',
  台江文化中心圖書館: '臺南市臺江文化中心圖書館',
};

function loadBranches() {
  try {
    const p = path.resolve(
      import.meta.dirname, '..', '..', 'ingest', 'raw', 'national-public-libraries.json',
    );
    const reg = JSON.parse(readFileSync(p, 'utf-8'));
    return reg.find((g) => g['縣市'] === '臺南市')?.['圖書館資訊'] ?? [];
  } catch {
    return []; // 名錄還沒抓過就先不帶座標，不讓 normalize 整支失敗
  }
}

const BRANCHES = loadBranches();

function findBranch(name) {
  if (!name) return null;
  const target = ALIAS[name] ?? name;
  return BRANCHES.find((l) => l.Name === target)
    ?? BRANCHES.find((l) => l.Name.endsWith(target))
    ?? null;
}

const STATUS = [
  [/額滿/, 'full'],
  [/尚未開始/, 'upcoming'],
  [/開放報名|報名中/, 'open'],
  [/截止|結束/, 'closed'],
  [/取消|停辦/, 'cancelled'],
];

const clean = (v) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s || undefined;
};

// 來源的說明欄位是 HTML（<div>、<br>、<img>），轉成純文字後才進 description
function stripHtml(v) {
  const s = String(v ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return s || undefined;
}

// 「2026/09/26 09:30 至 2026/09/26 11:30」→ ['2026/09/26 09:30', '2026/09/26 11:30']
const splitRange = (text) => String(text ?? '').split(/\s*至\s*/);

const isoDate = (text) => {
  const m = String(text ?? '').match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

const hhmm = (text) => String(text ?? '').match(/(\d{1,2}):(\d{2})/);

// 「2026/09/09 12:00」→ 2026-09-09T12:00:00+08:00（沒有時刻就不回傳，不補 00:00）
function isoDateTime(text) {
  const date = isoDate(text);
  const t = hhmm(text);
  if (!date || !t) return undefined;
  return `${date}T${String(Number(t[1])).padStart(2, '0')}:${t[2]}:00+08:00`;
}

export function normalize(records, { fetchedAt }) {
  const out = [];
  for (const r of records) {
    const url = clean(r?.['主活動資訊網址暨報名連結']);
    const activityId = url?.match(/\/(z[a-z0-9]+)\//)?.[1];
    const activityTitle = clean(r?.['主活動名稱']);
    if (!activityId || !activityTitle) continue;

    const sessions = Array.isArray(r['本活動內各場次資訊']) ? r['本活動內各場次資訊'] : [];
    const providerName = clean(r['主辦單位']);
    const branch = findBranch(providerName);
    const mainIntro = stripHtml(r['主活動主要說明']);

    sessions.forEach((s, i) => {
      const sessionTitle = clean(s?.['場次名稱']);
      // 場次名稱常常只是主活動的子標題，兩者不同才串起來，相同就不重複
      const title = sessionTitle && sessionTitle !== activityTitle
        ? `${activityTitle}－${sessionTitle}`
        : activityTitle;

      const [startRaw = '', endRaw = ''] = splitRange(s?.['活動時間']);
      const startDate = isoDate(startRaw);
      const endDate = isoDate(endRaw) ?? startDate;

      const course = {
        _source: 'tnpl-activities',
        _sourceRecordId: `${activityId}#${i}`,
        _fetchedAt: fetchedAt,
        title,
        provider: { nameRaw: providerName ?? '臺南市立圖書館', kind: 'library' },
        schedule: {
          // 預設單場；跨日的場次（例：研習班一期上到 12 月）在下面改成 irregular
          recurrence: 'single',
          slots: [],
        },
        enrollment: { status: 'unknown' },
        location: { addressPrecision: 'none' },
        sourceUrl: url,
      };

      if (startDate) course.schedule.startDate = startDate;
      if (endDate) course.schedule.endDate = endDate;
      // 起迄不同日的不是單場：這類多半是研習班一期（例「每周一、三 8:10-9:40」上到 12 月）。
      // 來源只給整期的起迄，沒有給「每週幾」的結構化欄位（上課星期寫在自由文字的說明裡），
      // 所以標 irregular、slots 留空，不從說明文字猜週期。
      if (startDate && endDate && endDate !== startDate) course.schedule.recurrence = 'irregular';
      const timeInfo = clean(s?.['活動時間']);
      if (timeInfo) course.schedule.timeInfoRaw = timeInfo;

      // ── 報名 ──
      const statusRaw = clean(s?.['報名狀態']);
      const status = STATUS.find(([re]) => re.test(statusRaw ?? ''))?.[1];
      if (status) course.enrollment.status = status;
      if (statusRaw) course.enrollment.statusRaw = statusRaw;
      const [openRaw = '', closeRaw = ''] = splitRange(s?.['報名時間']);
      const opensAt = isoDateTime(openRaw);
      const closesAt = isoDateTime(closeRaw);
      if (opensAt) course.enrollment.opensAt = opensAt;
      if (closesAt) course.enrollment.closesAt = closesAt;
      // 總名額；剩餘名額來源沒有給，不填 available（見檔頭）
      const capacity = String(s?.['可報名數'] ?? '').trim();
      if (/^\d+$/.test(capacity)) course.enrollment.capacity = Number(capacity);
      if (url) course.enrollment.registerUrl = url;

      // ── 內容 ──
      const category = clean(r['主活動主題']); // 閱讀培養／藝文推廣…
      if (category) course.categoryRaw = category;
      const audience = clean(r['主活動對象']); // 一般／樂齡／兒童／嬰幼兒…
      const ageLimit = clean(s?.['年齡限制']);
      const audienceRaw = [audience, ageLimit].filter(Boolean).join('；');
      if (audienceRaw) course.audienceRaw = audienceRaw;
      const teacher = clean(s?.['講師姓名']);
      if (teacher) course.teachers = [{ nameRaw: teacher }];
      const sessionIntro = stripHtml(s?.['活動說明']);
      const description = [sessionIntro, mainIntro].filter(Boolean).join('\n\n') || undefined;
      if (description) course.description = description;
      // 「否」＝不收費。只有明確兩個值才判定，其他寫法一律不填。
      const fee = clean(s?.['是否收費']);
      if (fee === '否') course.isFree = true;
      else if (fee === '是') course.isFree = false;

      // ── 地點 ──
      const hall = clean(s?.['活動地點']); // 館內位置，例：B1五感探索區
      const venueNameRaw = [providerName, hall].filter(Boolean).join(' ');
      if (branch) {
        course.location = {
          venueNameRaw: venueNameRaw || branch.Name,
          address: clean(branch.Address),
          addressPrecision: clean(branch.Address) ? 'street' : 'venue-name-only',
          city: '臺南市',
          district: clean(branch.Area),
        };
        // 座標直接取自公共圖書館基本資料名錄（CONTRACT §4：查證而來，非推測）
        if (Number.isFinite(branch.Latitude) && Number.isFinite(branch.Longitude)) {
          course.location.lat = branch.Latitude;
          course.location.lng = branch.Longitude;
          course.location.geocodeSource = 'registry';
        }
      } else if (venueNameRaw) {
        course.location = { venueNameRaw, addressPrecision: 'venue-name-only' };
      }

      out.push(course);
    });
  }
  return out;
}
