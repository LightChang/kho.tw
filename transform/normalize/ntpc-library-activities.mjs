// transform/normalize/ntpc-library-activities.mjs
// 新北市立圖書館活動報名（atpass）→ L1 Course（見 transform/L1-FORMAT.md）
//
// ── 名額（CONTRACT §5）──
// 這是少數 capacity 與 available 都填得出來的來源。列表欄位「已報名/名額」是
// `<已報名>/<總名額>`（例 `14/20`），所以：
//   capacity  = 分母
//   available = 分母 − 分子，夾在 0 以下不會發生（已報名不會超過名額，實測最大剛好相等）
// 分子分母缺一或不是數字就兩個都不填。候補名單（`候補名單 0`）**不併進 available**——
// 候補不是空位，把它加進去就是假的倒數。
//
// ── 狀態 ──
// 頁面自己標了狀態文字（「我要報名」／「已額滿」），直接用，不從日期反推。
// 只有在來源沒給狀態文字時才退回 available === 0 → full 的判斷。
//
// ── 一筆是一個場次 ──
// 列表本來就按場次展開，同一活動的不同場次各有日期與名額。
// `_sourceRecordId` 優先用頁面的場次 id（`showSessionDetail('<32 hex>')`），
// **已額滿的卡片沒有這段 JS**，所以退回「活動｜場次｜日期」雜湊後的短鍵。
// 兩者都是這一列的穩定識別，不會因翻頁順序而變。
//
// ── 地點與座標 ──
// 卡片沒有地址，館別寫在活動標題開頭的【】裡（【淡水分館】、【總館】）。
// 座標查 `ingest/raw/national-public-libraries.json`，對不到就只留名稱、不推測（CONTRACT §4）。
// 【全市】這種跨館活動沒有單一場地，不對應任何館。
// 實測 2026-09-13：54 筆裡 49 筆帶得出座標。對不到的 5 筆分兩類，都不硬湊：
//   2 筆「五股守讓堂」——古蹟館舍，不在公共圖書館基本資料名錄裡，只留場館名給 geocode 流程。
//   3 筆【全市】跨館活動——前綴不是館別。實際館名寫在場次名稱裡（「汐止大同分館(創藝空間)」），
//     要補的話得對場次名稱再做一次精確比對；本輪不做，寧可留白也不要掛到錯的館。
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// 名錄裡總館的登錄名稱就是「新北市立圖書館」（板橋區貴興路139號），沒有「總館」二字
const ALIAS = { 總館: '新北市立圖書館' };
// 跨館／全市活動，沒有單一場地
const NOT_A_BRANCH = /^(全市|跨館|其他)/;

function loadBranches() {
  try {
    const p = path.resolve(
      import.meta.dirname, '..', '..', 'ingest', 'raw', 'national-public-libraries.json',
    );
    const reg = JSON.parse(readFileSync(p, 'utf-8'));
    return reg.find((g) => g['縣市'] === '新北市')?.['圖書館資訊'] ?? [];
  } catch {
    return [];
  }
}

const BRANCHES = loadBranches();

function findBranch(prefix) {
  if (!prefix || NOT_A_BRANCH.test(prefix)) return null;
  // 兩館合辦寫成「汐止分館/汐止大同分館」，取前一個當場地
  const first = prefix.split(/[/、]/)[0].trim();
  const alias = ALIAS[first];
  if (alias) return BRANCHES.find((l) => l.Name === alias) ?? null;
  // 活動標題有時多寫一個「區」（林口區李科永紀念圖書館），名錄裡沒有（林口李科永紀念圖書館）
  const candidates = [first, first.replace(/^([^區]{2,3})區/, '$1')];
  for (const c of new Set(candidates)) {
    const m = BRANCHES.find((l) => l.Name === `新北市立圖書館${c}`)
      ?? BRANCHES.find((l) => l.Name.endsWith(c));
    if (m) return m;
  }
  return null;
}

const clean = (v) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s || undefined;
};

// 「2026-09-19 14:00」→ 2026-09-19
const isoDate = (text) => String(text ?? '').match(/(\d{4})-(\d{2})-(\d{2})/)?.[0];

// 「2026-07-15 10:00:00.0」→ 2026-07-15T10:00:00+08:00（沒有時刻就不補）
function isoDateTime(text) {
  const date = isoDate(text);
  const t = String(text ?? '').match(/\d{4}-\d{2}-\d{2}\s+(\d{1,2}):(\d{2})/);
  if (!date || !t) return undefined;
  return `${date}T${String(Number(t[1])).padStart(2, '0')}:${t[2]}:00+08:00`;
}

const shortHash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 16);

export function normalize(records, { fetchedAt }) {
  const out = [];
  for (const r of records) {
    const activityTitle = clean(r?.activityTitle);
    if (!activityTitle) continue;
    const sessionTitle = clean(r?.sessionTitle);
    const dateText = clean(r?.activityDateText);

    const recordId = r.sessionId
      || shortHash(`${activityTitle}|${sessionTitle ?? ''}|${dateText ?? ''}`);

    const title = sessionTitle && sessionTitle !== activityTitle
      ? `${activityTitle}－${sessionTitle}`
      : activityTitle;

    // 館別：標題開頭的【…】
    const prefix = clean(activityTitle.match(/^【([^】]+)】/)?.[1]);
    const branch = findBranch(prefix);

    const course = {
      _source: 'ntpc-library-activities',
      _sourceRecordId: recordId,
      _fetchedAt: fetchedAt,
      title,
      provider: {
        nameRaw: branch?.Name ?? (prefix ? `新北市立圖書館${prefix}` : '新北市立圖書館'),
        kind: 'library',
      },
      schedule: { recurrence: 'single', slots: [] },
      enrollment: { status: 'unknown' },
      location: { addressPrecision: 'none' },
      sourceUrl: clean(r?.url),
    };

    const startDate = isoDate(dateText);
    if (startDate) {
      course.schedule.startDate = startDate;
      course.schedule.endDate = startDate;
    }
    if (dateText) course.schedule.timeInfoRaw = dateText;

    // ── 報名 ──
    const quota = String(r?.quotaText ?? '').match(/^(\d+)\s*\/\s*(\d+)$/);
    if (quota) {
      const enrolled = Number(quota[1]);
      const capacity = Number(quota[2]);
      course.enrollment.capacity = capacity;
      course.enrollment.available = Math.max(capacity - enrolled, 0);
    }
    const statusRaw = clean(r?.stateText);
    if (statusRaw) course.enrollment.statusRaw = statusRaw;
    if (/額滿/.test(statusRaw ?? '')) course.enrollment.status = 'full';
    else if (/報名/.test(statusRaw ?? '')) course.enrollment.status = 'open';
    else if (course.enrollment.available === 0) course.enrollment.status = 'full';

    const opensAt = isoDateTime(r?.registerStartText);
    const closesAt = isoDateTime(r?.registerEndText);
    if (opensAt) course.enrollment.opensAt = opensAt;
    if (closesAt) course.enrollment.closesAt = closesAt;
    if (course.sourceUrl) course.enrollment.registerUrl = course.sourceUrl;

    // ── 內容 ──
    // 列表只給節錄（結尾是「....」），當簡介用，不假裝是完整說明
    const description = clean(r?.excerptText);
    if (description) course.description = description;

    // ── 地點 ──
    if (branch) {
      course.location = {
        venueNameRaw: branch.Name,
        address: clean(branch.Address),
        addressPrecision: clean(branch.Address) ? 'street' : 'venue-name-only',
        city: '新北市',
        district: clean(branch.Area),
      };
      if (Number.isFinite(branch.Latitude) && Number.isFinite(branch.Longitude)) {
        course.location.lat = branch.Latitude;
        course.location.lng = branch.Longitude;
        course.location.geocodeSource = 'registry';
      }
    } else if (prefix && !NOT_A_BRANCH.test(prefix)) {
      // 名錄查不到的場地（例：五股守讓堂這類非分館的館舍），只留名稱，座標交給 geocode 流程
      course.location = {
        venueNameRaw: `新北市立圖書館${prefix}`,
        addressPrecision: 'venue-name-only',
        city: '新北市',
      };
    }

    out.push(course);
  }
  return out;
}
