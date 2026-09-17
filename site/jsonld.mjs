// site/jsonld.mjs
// 產生 schema.org JSON-LD。
//
// 重要前提（2026-09-12 查證）：
//   Google 的「Course info」複合式搜尋結果已淘汰，說明文件已移除；
//   目前仍支援的是「Course list（課程輪轉介面）」，規格見
//   https://developers.google.com/search/docs/appearance/structured-data/course
//     Course 必要：name、description（顯示上限 60 字）
//     Course 建議：provider
//     清單頁：ItemList.itemListElement + ListItem.position + ListItem.url，且至少三門課
//   其餘屬性（hasCourseInstance、offers、location…）照 schema.org 詞彙寫，
//   對複合式結果沒有加分也不扣分，但對 AEO／LLM 取用是有用的事實。
//
// 列舉值來源：
//   https://schema.org/DayOfWeek        Monday…Sunday
//   https://schema.org/ItemAvailability InStock、SoldOut、PreOrder、OutOfStock、Discontinued…

export const SITE_URL = process.env.KHO_SITE_URL ?? 'https://kho.tw';

const DAY_OF_WEEK = [
  null, 'https://schema.org/Monday', 'https://schema.org/Tuesday', 'https://schema.org/Wednesday',
  'https://schema.org/Thursday', 'https://schema.org/Friday', 'https://schema.org/Saturday',
  'https://schema.org/Sunday',
];
const WEEKDAY_TW = ['', '週一', '週二', '週三', '週四', '週五', '週六', '週日'];

// 只對應語意明確的狀態。running（已開課）與 unknown 不寫 availability——
// 寧可不宣告，也不要宣稱一件我們不確定的事。
const AVAILABILITY = {
  open: 'https://schema.org/InStock',
  full: 'https://schema.org/SoldOut',
  upcoming: 'https://schema.org/PreOrder',
  closed: 'https://schema.org/OutOfStock',
  cancelled: 'https://schema.org/Discontinued',
};

const RECURRENCE_DURATION = {
  weekly: 'P1W',
  'twice-weekly': 'P1W',
  biweekly: 'P2W',
  'biweekly-twice': 'P2W',
};

// 社大、樂齡中心、進修部屬教育機構；運動中心、職訓單位用一般 Organization
const EDU_KINDS = new Set(['community-college', 'senior-center', 'adult-education', 'school-continuing']);

const clean = (o) => {
  if (Array.isArray(o)) {
    const arr = o.map(clean).filter((v) => v !== undefined);
    return arr.length ? arr : undefined;
  }
  if (o && typeof o === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(o)) {
      const c = clean(v);
      if (c !== undefined && c !== null && c !== '') out[k] = c;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return o;
};

// description 是 Course 的必要屬性，但來源只有 23.5% 有描述。
// 缺的用自己已有的事實組一句，不編造內容。
// Google 對 description 的顯示上限是 60 字，屬性本身沒有硬限制，但塞整篇課程簡介
// 對複合式結果與 LLM 取用都沒有幫助；截到 200 字，完整內容留在頁面正文。
const truncate = (s, n = 200) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function describe(course) {
  if (course.description?.trim()) return truncate(course.description.trim().replace(/\s+/g, ' '));
  const slot = course.schedule?.slots?.[0];
  const parts = [course.provider?.nameRaw];
  if (course.term?.raw) parts.push(course.term.raw);
  parts.push(`${course.categoryRaw ? `${course.categoryRaw}類` : ''}課程`);
  const when = [
    slot?.weekday ? WEEKDAY_TW[slot.weekday] : '',
    slot?.startTime ? `${slot.startTime}${slot.endTime ? `–${slot.endTime}` : ''}` : '',
  ].filter(Boolean).join(' ');
  if (when) parts.push(`${when}上課`);
  if (course.schedule?.startDate) parts.push(`自 ${course.schedule.startDate} 起`);
  const place = course.venue?.name;
  if (place) parts.push(`地點：${place}`);
  return `${parts.filter(Boolean).join('，')}。`;
}

function providerNode(course) {
  const name = course.provider?.nameRaw;
  if (!name) return undefined;
  return clean({
    '@type': EDU_KINDS.has(course.provider?.kind) ? 'EducationalOrganization' : 'Organization',
    name,
  });
}

function placeNode(venue) {
  if (!venue) return undefined;
  return clean({
    '@type': 'Place',
    name: venue.name,
    address: venue.address || venue.city
      ? clean({
        '@type': 'PostalAddress',
        streetAddress: venue.address,
        addressLocality: venue.district,
        addressRegion: venue.city,
        addressCountry: 'TW',
      })
      : undefined,
    geo: venue.lat && venue.lng
      ? { '@type': 'GeoCoordinates', latitude: venue.lat, longitude: venue.lng }
      : undefined,
  });
}

function offerNode(course) {
  const availability = AVAILABILITY[course.enrollment?.status];
  const hasPrice = course.price !== undefined || course.isFree === true;
  if (!availability && !hasPrice) return undefined;
  return clean({
    '@type': 'Offer',
    price: course.isFree ? 0 : course.price,
    priceCurrency: hasPrice ? 'TWD' : undefined,
    availability,
    availabilityStarts: course.enrollment?.opensAt,
    availabilityEnds: course.enrollment?.closesAt,
    url: course.sourceUrl,
    category: course.isFree ? 'Free' : undefined,
  });
}

function scheduleNode(course) {
  const s = course.schedule;
  const slot = s?.slots?.[0];
  if (!s?.startDate && !slot) return undefined;
  const byDay = (s?.slots ?? []).map((x) => DAY_OF_WEEK[x.weekday]).filter(Boolean);
  return clean({
    '@type': 'Schedule',
    startDate: s?.startDate,
    endDate: s?.endDate,
    startTime: slot?.startTime,
    endTime: slot?.endTime,
    byDay: byDay.length ? byDay : undefined,
    repeatFrequency: RECURRENCE_DURATION[s?.recurrence],
    repeatCount: s?.weeks,
    scheduleTimezone: 'Asia/Taipei',
  });
}

// 網址一律用 slug（中文），所以每一段都要百分比編碼：
// /course/飛越拉拉二胡-五權社大-8d29b.html → /course/%E9%A3%9B%E8%B6%8A…-8d29b.html
// 這裡的編碼方式必須與 site/sitemap.mjs 的 toLoc() 一致，否則 canonical 與 sitemap 會對不起來。
export const pageUrl = (dir, slug) => `${SITE_URL}/${dir}/${encodeURIComponent(slug)}.html`;

export function courseUrl(course) {
  return pageUrl('course', course.slug);
}

export function venueUrl(venue) {
  return pageUrl('venue', venue.slug);
}

export function teacherUrl(teacher) {
  return pageUrl('teacher', teacher.slug);
}

export function courseJsonLd(course, venue) {
  const schedule = scheduleNode(course);
  const instance = clean({
    '@type': 'CourseInstance',
    courseMode: 'onsite',
    courseSchedule: schedule,
    location: placeNode(venue) ?? (course.venue?.name ? { '@type': 'Place', name: course.venue.name } : undefined),
    instructor: (course.teachers ?? []).map((t) => clean({ '@type': 'Person', name: t.nameRaw })),
    offers: offerNode(course),
  });
  return clean({
    '@context': 'https://schema.org',
    '@type': 'Course',
    '@id': courseUrl(course),
    url: courseUrl(course),
    name: course.title,
    description: describe(course),
    inLanguage: 'zh-Hant-TW',
    provider: providerNode(course),
    hasCourseInstance: instance,
    offers: offerNode(course),
    isAccessibleForFree: course.isFree,
    timeRequired: course.schedule?.hours ? `PT${course.schedule.hours}H` : undefined,
  });
}

// 清單頁：Course list 要求 ItemList.itemListElement 帶 position 與 url，且至少三門課
export function itemListJsonLd(courses, { name }) {
  if (!courses || courses.length < 3) return undefined;
  return clean({
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name,
    numberOfItems: courses.length,
    itemListElement: courses.map((c, i) => clean({
      '@type': 'ListItem',
      position: i + 1,
      url: courseUrl(c),
      name: c.title,
    })),
  });
}

// 索引頁（例如 /topics.html）：收的是站內頁面而不是課程，所以不能用 itemListJsonLd。
// 同樣照 ItemList 規格寫 position／url／name，讓「主題分類」這一層也能被機器讀出來。
// items：[{ url（絕對網址）, name, n?（收錄筆數，寫進 ListItem 的 description 太重，改用 numberOfItems 於各分類頁表達）}]
export function pageListJsonLd(items, { name }) {
  if (!items || items.length < 3) return undefined;
  return clean({
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name,
    numberOfItems: items.length,
    itemListElement: items.map((it, i) => clean({
      '@type': 'ListItem',
      position: i + 1,
      url: it.url,
      name: it.name,
    })),
  });
}

// 首頁的實體宣告：Organization + WebSite（geo-audit 的「首頁缺 Organization/WebSite」硬缺口）。
// 欄位只取站上已經有的事實：站名、網址、apple-touch-icon.png（唯一現成的方形圖像資產，
// 180×180，符合 Google logo 建議的最小尺寸；favicon.svg 是向量圖，Google 的 logo 規格不收）、
// 首頁搜尋功能（/search.html?q=，src/pages/search.astro 實際讀取的參數名）。
// 沒有法定名稱、地址、電話、sameAs 等站外或未公開的事實，一律不寫——
// 殘缺的結構化資料在 Google 眼裡是「無效項目」，比沒有更糟（本平台既有教訓）。
export function organizationJsonLd({ description } = {}) {
  return clean({
    '@type': 'Organization',
    '@id': `${SITE_URL}/#organization`,
    name: 'kho.tw',
    url: SITE_URL,
    logo: `${SITE_URL}/apple-touch-icon.png`,
    description,
  });
}

export function webSiteJsonLd() {
  return clean({
    '@type': 'WebSite',
    '@id': `${SITE_URL}/#website`,
    name: 'kho.tw',
    url: SITE_URL,
    inLanguage: 'zh-Hant-TW',
    publisher: { '@id': `${SITE_URL}/#organization` },
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${SITE_URL}/search.html?q={search_term_string}` },
      'query-input': 'required name=search_term_string',
    },
  });
}

// 首頁把兩個節點包進同一個 @graph：一個 <script> 標籤、共用一個 @context，
// 語意上等同各自輸出，但省一次 script 標籤（geo-audit 用遞迴 walk 抓型別，@graph 陣列一樣抓得到）。
export function homeJsonLd({ description } = {}) {
  return clean({
    '@context': 'https://schema.org',
    '@graph': [organizationJsonLd({ description }), webSiteJsonLd()],
  });
}

export function venueJsonLd(venue, courses) {
  const place = placeNode(venue);
  if (!place) return undefined;
  return clean({
    '@context': 'https://schema.org',
    ...place,
    '@id': venueUrl(venue),
    url: venueUrl(venue),
    event: undefined, // 課程不是 Event，關係由 ItemList 表達
    additionalProperty: courses?.length
      ? { '@type': 'PropertyValue', name: '課程數', value: courses.length }
      : undefined,
  });
}
