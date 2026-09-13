// transform/normalize/nlpi-activities.mjs
// 國立公共資訊圖書館活動報名 → L1 Course（見 transform/L1-FORMAT.md）
//
// 這是**活動**不是期別課程：多數是單場講座或常態展覽，所以 recurrence 用 single／irregular、
// slots 留空（沒有「每週幾」這回事），時間放 schedule.startDate／endDate 與 timeInfoRaw。
//
// ── 名額（CONTRACT §5）──
// `available` 只在**單場次**活動才填，值取詳情頁該場次的「剩餘名額」。
// 多場次活動不填：列表的「餘額」是各場次剩餘的**總和**（實測 ss=90F2A0521C93A50E
// 列表 642 ＝ 218＋214＋210），總和不是「這個活動還剩幾個位子」，填進去首頁的「快額滿」
// 就會出現假的倒數。`capacity`（總名額）來源從頭到尾沒有給，一律不填。
// 「不限制」是免報名活動的寫法，不是數字，也不填。
//
// ── 狀態 ──
// 報名中→open、尚未開始→upcoming、報名額滿→full、報名截止→closed、
// 無需報名→unknown（免報名的展覽或常態活動，那不是報名狀態，statusRaw 留原文）。
//
// ── 地點 ──
// 詳情頁場次表的地點是館內位置（「總館-3樓多元學習教室」「中興分館-4樓研習教室」），
// 沒有門牌。總館在臺中市、中興分館在南投縣，靠字串猜縣市會把課掛到錯的行政區，
// 所以只填 venueNameRaw（冠上館名方便地理編碼）與 venue-name-only，不填 city／address。
const STATUS = [
  [/額滿/, 'full'],
  [/尚未開始|即將開始/, 'upcoming'],
  [/報名中|開放報名/, 'open'],
  [/截止|結束/, 'closed'],
  [/取消|停辦|停止/, 'cancelled'],
];

// ingest 的 htmlText 只解數值實體與 &lt; &gt; &quot; &apos; &amp;，國資圖的簡介另外用了這幾個
// 具名實體（實測 &mdash; 30 次、&aacute; 9、&times; 5、&ndash; 5、&rsquo; 3、&scaron; 2），
// 不解會原樣留在 description 裡，所以在這一層補一張小對照表；表上沒有的原樣保留，不亂猜。
const ENTITIES = {
  mdash: '—', ndash: '–', times: '×', deg: '°', middot: '·', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•', trade: '™',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
  ntilde: 'ñ', ccedil: 'ç', scaron: 'š', auml: 'ä', ouml: 'ö', uuml: 'ü',
};

const clean = (v) => {
  const s = String(v ?? '')
    .replace(/&([a-zA-Z][a-zA-Z0-9]{1,10});/g, (m, name) => ENTITIES[name] ?? m)
    .trim();
  return s || undefined;
};

// 民國日期：「115-09/12」「115/09/12」「115/10/20 10:00」 → 2026-09-12
function rocDate(text) {
  const m = String(text ?? '').match(/(\d{3})[-/](\d{1,2})\/(\d{1,2})/);
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]) + 1911, Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// 「115/07/07 (二)11:17」 → 2026-07-07T11:17:00+08:00（沒有時刻就不回傳，不補 00:00）
function rocDateTime(text) {
  const date = rocDate(text);
  if (!date) return undefined;
  const t = String(text).match(/(\d{1,2}):(\d{2})/);
  if (!t) return undefined;
  return `${date}T${String(Number(t[1])).padStart(2, '0')}:${t[2]}:00+08:00`;
}

// 「115-09/12 ~ 115-11/14」／「115/07/07 (二)11:17 ~ 115/11/12 (四)23:59」
const splitRange = (text) => String(text ?? '').split('~');

export function normalize(records, { fetchedAt }) {
  const out = [];
  for (const r of records) {
    if (!r?.activityId) continue;
    const title = clean(r.title);
    if (!title) continue;

    const sessions = Array.isArray(r.sessions) ? r.sessions : [];
    const [startRaw = '', endRaw = ''] = splitRange(r.listActivityRangeText);

    const course = {
      _source: 'nlpi-activities',
      _sourceRecordId: String(r.activityId),
      _fetchedAt: fetchedAt,
      title,
      provider: { nameRaw: '國立公共資訊圖書館', kind: 'library' },
      schedule: {
        // 單場次＝single；多場次的日期不規則（9/12、10/3、11/14），不是每週一次
        recurrence: sessions.length > 1 ? 'irregular' : 'single',
        slots: [],
      },
      enrollment: { status: 'unknown' },
      location: { addressPrecision: 'none' },
      sourceUrl: clean(r.url),
    };

    const startDate = rocDate(startRaw);
    const endDate = rocDate(endRaw) ?? startDate;
    if (startDate) course.schedule.startDate = startDate;
    if (endDate) course.schedule.endDate = endDate;
    const timeInfo = clean(r.activityTimeText);
    if (timeInfo) course.schedule.timeInfoRaw = timeInfo;
    if (sessions.length > 1) course.schedule.sessions = sessions.length;

    // ── 報名 ──
    const statusRaw = clean(r.statusText);
    const status = STATUS.find(([re]) => re.test(statusRaw ?? ''))?.[1];
    if (status) course.enrollment.status = status;
    if (statusRaw) course.enrollment.statusRaw = statusRaw;
    const [openRaw = '', closeRaw = ''] = splitRange(r.registerTimeText);
    const opensAt = rocDateTime(openRaw);
    const closesAt = rocDateTime(closeRaw);
    if (opensAt) course.enrollment.opensAt = opensAt;
    if (closesAt) course.enrollment.closesAt = closesAt;
    // 只有單場次的「剩餘名額」才是這個活動的剩餘名額，多場次的總和不填（見檔頭）
    if (sessions.length === 1 && /^\d+$/.test(String(sessions[0].remainingText ?? '').trim())) {
      course.enrollment.available = Number(sessions[0].remainingText);
    }
    if (course.sourceUrl) course.enrollment.registerUrl = course.sourceUrl;

    // ── 內容 ──
    const category = clean(r.categoryText); // 講座／研習／展覽／活動／電影欣賞
    if (category) course.categoryRaw = category;
    const audience = clean(r.audienceText); // 一般大眾／樂齡／親子兒童／青少年…
    if (audience) course.audienceRaw = audience;
    const description = clean(r.introText);
    if (description) course.description = description;

    // ── 地點 ──
    const venues = [...new Set(sessions.map((s) => clean(s.venueText)).filter(Boolean))];
    if (venues.length === 1) {
      course.location = {
        venueNameRaw: `國立公共資訊圖書館${venues[0]}`,
        addressPrecision: 'venue-name-only',
      };
    } else if (venues.length > 1) {
      // 場次散在不同館（總館與分館），單一 venue 無法代表整個活動，只留原文
      course.location = { venueNameRaw: venues.join('、'), addressPrecision: 'none' };
    }

    out.push(course);
  }
  return out;
}
