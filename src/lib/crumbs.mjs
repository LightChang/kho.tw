// 麵包屑：每種頁型的層級在這裡定一次。
// 回傳 [{ name, href }]，href 是站內路徑（已百分比編碼）；最後一項是本頁，不帶 href。
// 同一個陣列同時給可見的 <nav>（src/components/Breadcrumbs.astro）與 BreadcrumbList JSON-LD
// （site/jsonld.mjs 的 breadcrumbJsonLd），兩者不會對不起來。
//
// 層級照頁首導覽列的入口：首頁 › 入口頁（可報名、主題、想學什麼、證照班、類型、縣市、地圖、講師、搜尋）› 細頁。
// 課程頁與場館頁掛在所在縣市下面（縣市頁是它們最常見的上一層）；沒有縣市頁的就直接掛首頁。
// 首頁本身沒有麵包屑（滿版版面，且只有一層）。
import { link, learnHref, certHref } from './data.mjs';

const HOME = { name: '首頁', href: '/' };

// 入口頁：名稱與頁首導覽列一致
export const SECTIONS = {
  open: { name: '可報名', href: '/open.html' },
  topics: { name: '主題', href: '/topics.html' },
  learn: { name: '想學什麼', href: '/learn.html' },
  cert: { name: '證照班', href: certHref() },
  types: { name: '類型', href: '/types.html' },
  cities: { name: '縣市', href: '/cities.html' },
  map: { name: '地圖', href: '/map.html' },
  teachers: { name: '講師', href: '/teachers.html' },
  search: { name: '搜尋', href: '/search.html' },
};

const here = (name) => ({ name });

/** 入口頁本身：首頁 › 可報名 */
export const sectionCrumbs = (key) => [HOME, here(SECTIONS[key].name)];

/** 入口頁底下的一頁：首頁 › 主題 › 語言 */
export const underSection = (key, name) => [HOME, SECTIONS[key], here(name)];

/** 縣市之下（課程、場館）：首頁 › 縣市 › 臺北市 › 本頁。city 沒有縣市頁時省略縣市兩層。 */
export function underCity(city, name, cityPages) {
  if (city && cityPages?.has(city)) return [HOME, SECTIONS.cities, { name: city, href: link('city', city) }, here(name)];
  return [HOME, here(name)];
}

/** 細項頁：首頁 › 想學什麼 › 瑜珈 [› 臺北市 [› 內湖區]]。cityArea：該細項有縣市頁時的 area 參數，沒有就不放縣市這一層。 */
export function learnCrumbs({ name, label }, { city, district, cityArea } = {}) {
  const top = [HOME, SECTIONS.learn];
  if (!city) return [...top, here(label)];
  const act = { name: label, href: learnHref(name) };
  if (!district) return [...top, act, here(city)];
  const mid = cityArea ? [{ name: city, href: learnHref(name, cityArea) }] : [];
  return [...top, act, ...mid, here(district)];
}

/** 需求專題頁（產投、免費課、銀髮課）：首頁 › 專題 [› 縣市]。專題不在導覽列，直接掛首頁下。 */
export function hubCrumbs(name, href, city) {
  if (!city) return [HOME, here(name)];
  return [HOME, { name, href }, here(city)];
}

/** 場館 × 細項頁：首頁 › 縣市 › 臺中市 › 北屯運動中心 › 皮拉提斯。city 沒有縣市頁時省略縣市兩層。 */
export function underVenue(city, venue, label, cityPages) {
  return [...underCity(city, venue.name, cityPages).slice(0, -1), venue, here(label)];
}
