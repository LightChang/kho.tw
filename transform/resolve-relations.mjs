// transform/resolve-relations.mjs
// L3 關聯：把 cluster（課程）連到 venue（場館），並允許懸空邊。
// 沿用 seh.tw ARCHITECTURE.md §5：邊是一級資料，未解析的邊照樣存下來——
// 課程頁還是顯示得出地點文字，只是不連到場館頁，同時自動產生待辦清單。
//
// 場館來源有三種，依可信度排序：
//   registry  場館名錄（尚未接，見 docs/pipeline.md §5）
//   geocoded  L1 的 address 在 geocode/out/geocoded.csv 查得到座標
//   derived   只有地址文字或場地名，先建一個沒有座標的 venue
//
// 產出：
//   data/venues.ndjson     依 id 排序的場館
//   data/relations.ndjson  course → venue 的邊（含懸空）
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { todayTaipei } from './_date.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const OBS_DIR = path.join(ROOT, 'data', 'observation');
const CLUSTERS = path.join(ROOT, 'data', 'clusters.ndjson');
const GEOCODED = path.join(ROOT, 'geocode', 'out', 'geocoded.csv');
const VENUES_OUT = path.join(ROOT, 'data', 'venues.ndjson');
const RELATIONS_OUT = path.join(ROOT, 'data', 'relations.ndjson');

const hash8 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 8);

const CN_DIGIT = { 零: 0, 〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

// 「一百零八」→108。不是純中文數字就回 null。
export function cnToInt(s) {
  if (!s || [...s].some((c) => !(c in CN_DIGIT) && c !== '十' && c !== '百')) return null;
  let total = 0;
  let cur = 0;
  for (const c of s) {
    if (c === '百') { total += (cur || 1) * 100; cur = 0; }
    else if (c === '十') { total += (cur || 1) * 10; cur = 0; }
    else cur = CN_DIGIT[c];
  }
  return total + cur;
}

// 和 geocode/build_tgos_input.py 的正規化對齊：全形轉半形、去郵遞區號、中文數字門牌轉阿拉伯、
// 只留到「號」。沒對齊的話「濟南路一段六號」與「濟南路一段6號」會變成兩個場館。
export function normAddress(raw) {
  let s = String(raw ?? '').trim();
  if (!s) return '';
  s = s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  s = s.replace(/台/g, '臺').replace(/\s+/g, '');
  s = s.replace(/^\d{3,6}/, '');
  s = s.replace(/[（(][^）)]*[）)]?/g, '');
  // 段號也要對齊，而且要在「號」之前處理——兩者都用中文數字，先做段才不會互相干擾。
  // 實例：data.taipei 121203 寫「中山北路2段44巷2號」，全國運動場館資訊寫「中山北路二段44巷2號」，
  // 同一座中山運動中心因此比對不到。12 座北市運動中心裡有 4 座（中山、中正、北投、大安）
  // 都栽在這裡。全站有地址的觀測裡 19.6% 用中文段號、7.2% 用阿拉伯段號，不是零星個案。
  s = s.replace(/([零〇一二三四五六七八九十]+)段/, (m, d) => {
    const n = cnToInt(d);
    return n === null ? m : `${n}段`;
  });
  s = s.replace(/([零〇一二三四五六七八九十百]+)號/, (m, d) => {
    const n = cnToInt(d);
    return n === null ? m : `${n}號`;
  });
  s = s.replace(/(\d+)[-~](\d+)號/, '$1之$2號');
  const m = s.match(/^(.*?\d+(?:之\d+)?號)/);
  return m ? m[1] : s;
}

async function readNdjson(file) {
  try {
    const text = await readFile(file, 'utf-8');
    return text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

async function loadGeocoded() {
  const map = new Map();
  let text;
  try {
    text = await readFile(GEOCODED, 'utf-8');
  } catch {
    return map; // TGOS 結果還沒回來，全部邊會是懸空狀態，這是預期行為
  }
  const lines = text.replace(/^﻿/, '').split('\n').filter(Boolean);
  const header = lines[0].split(',');
  const iAddr = header.indexOf('address');
  const iLat = header.indexOf('lat');
  const iLng = header.indexOf('lng');
  for (const line of lines.slice(1)) {
    const cols = line.split(',');
    const addr = normAddress(cols[iAddr]);
    const lat = Number(cols[iLat]);
    const lng = Number(cols[iLng]);
    if (addr && Number.isFinite(lat) && Number.isFinite(lng)) map.set(addr, { lat, lng });
  }
  return map;
}

const COUNTIES = new Set([
  '臺北市', '新北市', '桃園市', '臺中市', '臺南市', '高雄市', '基隆市', '新竹市', '嘉義市',
  '新竹縣', '苗栗縣', '彰化縣', '南投縣', '雲林縣', '嘉義縣', '屏東縣', '宜蘭縣', '花蓮縣',
  '臺東縣', '澎湖縣', '金門縣', '連江縣',
]);

// 來源的縣市欄位會出現「其他」「線上」這種非地名的值，直接當成沒有縣市，
// 否則首頁的縣市入口會多出一個叫「其他」的假縣市。
export function cityOf(raw) {
  const s = String(raw ?? '').replace(/台/g, '臺').trim();
  return COUNTIES.has(s) ? s : null;
}

// 行政區：多數來源只給縣市，但地址字串裡本來就寫著行政區
//（「臺中市西區五權路2之3號」的 district 是 null，可是「西區」就在地址裡）。
// 課程層 6,495 門、場館層 1,179 個可以這樣補回來。
//
// **不用 regex 抓**：/^(縣市)([一-龥]{1,3}?[區鄉鎮市])/ 的非貪婪會先吃到
// 「前鎮區」的「鎮」，把它抓成「前鎮」——578 筆對照組有 8 筆栽在這裡。
// 改成比對 overrides/districts.json（政府名錄自帶的 city+district 建的對照表），
// 只認「該縣市底下真實存在的行政區」，錯誤降到 4 筆，而那 4 筆是現有資料本身標錯。
//
// 取**最長**命中：「臺南市新市區」不能被「新市」搶走，「臺中市大安區」同理。
const DISTRICTS = JSON.parse(
  readFileSync(new URL('../overrides/districts.json', import.meta.url), 'utf-8'),
).districts;

export function districtOf(city, address) {
  const list = DISTRICTS[cityOf(city)];
  if (!list || !address) return null;
  let best = null;
  for (const d of list) {
    if (address.includes(d) && (!best || d.length > best.length)) best = d;
  }
  return best;
}

// 場館名正規化：用來把課程的場地名對到名錄（「臺北市中山運動中心」vs「台北市中山運動中心」）
//
// 也要剝掉學校的設立別前綴。教育部學校名錄寫「市立板橋國中」「私立育才國小」
// 「國立政治大學」，課程的地點欄卻只寫「板橋國中」「育才國小」「政治大學」，
// 不剝就永遠對不上——而借用學校場地的課正是 derived-name 那 4,871 門的大宗。
// 只比對字串開頭，所以「臺北市立圖書館」不受影響（它開頭是「臺」不是「市立」）。
const SCHOOL_PREFIX = /^(國立|市立|縣立|私立|公立)/;

export function normVenueName(raw) {
  return String(raw ?? '')
    .replace(/台/g, '臺')
    .replace(/[\s　（）()]/g, '')
    .replace(SCHOOL_PREFIX, '')
    .trim();
}

// 名錄類來源（entityKind = venue）進 observation 後，就是這裡的場館池。
// 運動場館名錄 9,861 個場館全部帶 WGS84 座標，對上就不必等 geocode。
async function loadRegistry() {
  const byAddress = new Map();
  const byName = new Map();
  let files = [];
  try {
    files = (await readdir(OBS_DIR)).filter((f) => f.endsWith('.ndjson'));
  } catch {
    return { byAddress, byName };
  }
  for (const f of files.sort()) {
    for (const o of await readNdjson(path.join(OBS_DIR, f))) {
      if (o.entityKind !== 'venue' || o.disappearedAt) continue;
      const p = o.payload;
      const venue = {
        id: `ven_${hash8(`${p._source}|${p._sourceRecordId}`)}`,
        name: p.name,
        address: normAddress(p.address) || null,
        city: p.city ?? null,
        district: p.district ?? null,
        lat: p.lat ?? null,
        lng: p.lng ?? null,
        source: 'registry',
        registrySource: p._source,
        kindRaw: p.kindRaw ?? null,
      };
      // 有座標的名錄優先（運動場館），避免被沒座標的名錄覆蓋
      const better = (a, b) => (a?.lat ? a : (b?.lat ? b : a ?? b));
      if (venue.address) byAddress.set(venue.address, better(byAddress.get(venue.address), venue));
      const key = normVenueName(venue.name);
      if (key) {
        byName.set(key, better(byName.get(key), venue));
        // 名錄寫「大里國民暨兒童運動中心」，課程寫「臺中市大里國民暨兒童運動中心」，
        // 同一座場館兩種寫法。多存一個去掉縣市前綴的鍵，兩邊才對得上。
        const stripped = key.replace(/^(臺北市|新北市|桃園市|臺中市|臺南市|高雄市|基隆市|新竹市|嘉義市|新竹縣|苗栗縣|彰化縣|南投縣|雲林縣|嘉義縣|屏東縣|宜蘭縣|花蓮縣|臺東縣|澎湖縣|金門縣|連江縣)/, '');
        if (stripped && stripped !== key) byName.set(stripped, better(byName.get(stripped), venue));
      }
    }
  }
  return { byAddress, byName };
}

async function loadPayloads() {
  const map = new Map();
  let files = [];
  try {
    files = (await readdir(OBS_DIR)).filter((f) => f.endsWith('.ndjson'));
  } catch {
    return map;
  }
  for (const f of files.sort()) {
    for (const o of await readNdjson(path.join(OBS_DIR, f))) {
      if (o.disappearedAt) continue;
      map.set(o.id, o.payload);
    }
  }
  return map;
}

// 一個 cluster 可能有多個來源提供地點，挑資訊最完整的那個
const PRECISION_RANK = { street: 4, district: 3, city: 2, 'venue-name-only': 1, none: 0 };

export function bestLocation(payloads) {
  let best = null;
  let bestScore = -1;
  for (const p of payloads) {
    const loc = p.location ?? {};
    const score = (PRECISION_RANK[loc.addressPrecision] ?? 0) * 10
      + (loc.address ? 4 : 0) + (loc.district ? 2 : 0) + (loc.city ? 1 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = { ...loc, providerNameRaw: p.provider?.nameRaw, providerKind: p.provider?.kind };
    }
  }
  return best ?? {};
}

async function main() {
  const clusters = await readNdjson(CLUSTERS);
  if (clusters.length === 0) throw new Error('找不到 data/clusters.ndjson，請先跑 transform/cluster.mjs');
  const payloads = await loadPayloads();
  const geocoded = await loadGeocoded();
  const registry = await loadRegistry();

  const venues = new Map();
  const relations = [];
  const today = todayTaipei();
  const stats = { geocoded: 0, derivedAddress: 0, derivedName: 0, dangling: 0 };

  for (const cluster of clusters) {
    const members = cluster.members.map((m) => payloads.get(m.observationId)).filter(Boolean);
    if (members.length === 0) continue;
    const loc = bestLocation(members);
    const addr = normAddress(loc.address);
    // 「其他」「戶外」「線上課程」這類是佔位字串，不是場地；當成沒有場館（懸空邊），
    // 否則會生出一個叫「其他」、掛著幾十門課的假場館。
    const isPlaceholder = (name) => !name
      || /^(其他|戶外|線上|遠距|視訊|校外|待定|未定|不定|另行通知|依公告)/.test(String(name).trim());
    // 場館自營來源（運動中心等）沒有地址，但場館本身就是 provider
    // 場館自營的來源（運動中心、樂齡中心）把教室名接在場館名後面：
    // 「臺中市大里國民暨兒童運動中心 韻律C瑜珈教室」。用整串當場館，同一座中心會被
    // 每間教室拆成好幾個場館，所以這類來源一律用乾淨的 provider 名當場館，教室只留在課程層。
    const selfOperated = loc.providerKind === 'sports-center' || loc.providerKind === 'senior-center';
    const venueNameCandidate = (selfOperated && loc.providerNameRaw)
      ? loc.providerNameRaw
      : (loc.venueNameRaw || '');
    const venueName = isPlaceholder(venueNameCandidate) ? '' : venueNameCandidate;

    let venueId = null;
    let method = 'none';
    let confidence = 0;
    // 先對名錄：門牌相同 → 場地名相同 → 主辦單位名相同（運動中心、樂齡中心是場館自營課程，
    // provider 就是場館本身）。運動場館名錄帶 WGS84 座標，對上就不必等 geocode。
    // 查詢端也要試「去掉縣市前綴」的寫法，否則索引多存的那個鍵永遠查不到：
    // 課程寫「臺中市大里國民暨兒童運動中心」，名錄寫「大里國民暨兒童運動中心」。
    const COUNTY_PREFIX = /^(臺北市|新北市|桃園市|臺中市|臺南市|高雄市|基隆市|新竹市|嘉義市|新竹縣|苗栗縣|彰化縣|南投縣|雲林縣|嘉義縣|屏東縣|宜蘭縣|花蓮縣|臺東縣|澎湖縣|金門縣|連江縣)/;
    const lookupName = (raw) => {
      const key = normVenueName(raw);
      if (!key) return undefined;
      return registry.byName.get(key) ?? registry.byName.get(key.replace(COUNTY_PREFIX, ''));
    };
    const regByAddr = addr ? registry.byAddress.get(addr) : undefined;
    // 候選順序是門牌 → 場地名 → 主辦單位名，但**有座標的優先**。
    // 同一座場館可能在門牌索引指到沒座標的名錄（社大據點、樂齡中心），
    // 在名稱索引卻指到有座標的那份（全國運動場館、公共圖書館）。照原順序取
    // 會拿到沒座標的那筆，把已經有的座標白白丟掉——2026-09-13 實測 52 個鍵、
    // 1,109 門課是這種情況。byAddress/byName 建索引時的 better() 只解決
    // 「同一個鍵」的競爭，管不到這種跨鍵的情形。
    // 名稱比對不可以跨縣市。名錄裡同名不同地址的場館有 750 組（「田徑場」279 個、
    // 「校本部」104 個、「籃球場館」102 個），純名稱比對會把不同縣市的課全部串到
    // 同一個場館上——實測臺東的課掛進「澎湖縣社區大學」、臺北的課掛進臺中「太平國小」。
    // 課程與名錄兩邊都知道縣市時就必須一致；有一邊不知道才容許（不然會退步太多）。
    const sameCounty = (r) => {
      const a = cityOf(loc.city);
      const b = cityOf(r.city);
      return !a || !b || a === b;
    };
    const regCandidates = [regByAddr, lookupName(venueName), lookupName(loc.providerNameRaw)]
      .filter(Boolean)
      .filter((r) => r === regByAddr || sameCounty(r));
    // 名錄候選全都沒座標、而課程自己的門牌在 geocoded.csv 裡查得到時，**不要改用名錄**。
    //
    // 改用名錄會把 venueId 從 hash8(門牌) 換成 hash8(名錄來源|記錄)，而名錄自己的門牌
    // 不見得在快取裡（寫法不同、或根本沒送過 TGOS），等於把手上已經有的座標丟掉。
    // 2026-09-13 接教育部學校名錄時實測：36 個場館、152 門課就是這樣掉的
    //（立農國小、成德國小、文湖國小…原本都靠 geocoded-address 拿到座標）。
    //
    // 只擋名稱比對這條路。門牌命中名錄（registry-address）時，課程地址與名錄門牌
    // 是同一個鍵，下面 registry 分支自己查快取就會命中，不會有這個問題。
    const geoHit = addr ? geocoded.get(addr) : undefined;
    const reg = regCandidates.find((r) => r.lat)
      ?? regByAddr
      ?? (geoHit ? null : regCandidates[0])
      ?? null;
    if (reg) {
      venueId = reg.id;
      method = reg === regByAddr ? 'registry-address' : 'registry-name';
      const prev = venues.get(venueId) ?? { ...reg, courseCount: 0 };
      // 名錄沒座標時回頭查 TGOS 的結果。少了這段，只要對得到名錄，
      // 門牌就算已經在 geocoded.csv 裡有座標也永遠補不上——因為這個分支
      // 先命中就定案，下面的 geocoded 查詢只有「對不到名錄」的課才會走到。
      //
      // 但**只能用名錄自己的門牌去查，不能用課程的地址**。
      // 場館的身分來自名錄（門牌或名稱比對），課程的地址卻可能是完全不同的地方：
      // 實測「澎湖縣社區大學」掛的 183 門課裡有 83 門的地址是「臺東市中華路1段684號」
      // （課程寫的 provider 是澎湖社大、上課地點在臺東），拿課程地址去查快取，
      // 就把臺東的座標寫進了澎湖的場館，整個場館連同 183 門課標到臺東外海。
      // 臺中太平國小拿到臺北延平北路的座標也是同一個原因。
      if (!prev.lat && prev.address) {
        const coords = geocoded.get(prev.address);
        if (coords) {
          prev.lat = coords.lat;
          prev.lng = coords.lng;
          prev.source = 'registry+geocoded';
          stats.registryGeocoded = (stats.registryGeocoded ?? 0) + 1;
        }
      }
      confidence = prev.lat ? 0.95 : 0.8;
      stats[method] = (stats[method] ?? 0) + 1;
      prev.courseCount += 1;
      if (!prev.city && cityOf(loc.city)) prev.city = cityOf(loc.city);
      // 名錄的門牌優先於課程的地址：場館的身分來自名錄，課程地址可能是別的地方
      // （同一個理由見上面補座標那段）。
      if (!prev.district) prev.district = loc.district ?? districtOf(prev.city, prev.address);
      venues.set(venueId, prev);
    } else if (addr) {
      venueId = `ven_${hash8(addr)}`;
      const coords = geocoded.get(addr);
      method = coords ? 'geocoded-address' : 'derived-address';
      confidence = coords ? 0.95 : 0.6;
      if (coords) stats.geocoded += 1; else stats.derivedAddress += 1;
      // 場館名優先用真正的名稱；來源把門牌塞在 venueNameRaw 時（北市聯網就是這樣），
      // 用正規化後的 address 當名稱，否則會出現 name 與 address 寫法不一致的同一個場館。
      const looksLikeAddress = /\d+\s*號|[一二三四五六七八九十]+號/.test(venueName);
      const displayName = venueName && !looksLikeAddress ? venueName : addr;
      const prev = venues.get(venueId) ?? {
        id: venueId, name: displayName, address: addr, source: coords ? 'geocoded' : 'derived',
        city: cityOf(loc.city), district: loc.district ?? districtOf(cityOf(loc.city), addr),
        lat: coords?.lat ?? null, lng: coords?.lng ?? null, courseCount: 0,
      };
      prev.courseCount += 1;
      if (!prev.city && cityOf(loc.city)) prev.city = cityOf(loc.city);
      if (!prev.district) prev.district = loc.district ?? districtOf(prev.city, addr);
      venues.set(venueId, prev);
    } else if (venueName) {
      venueId = `ven_${hash8(`name:${venueName}`)}`;
      method = 'derived-name';
      confidence = 0.4;
      stats.derivedName += 1;
      // 場館名開頭若是合法縣市（「臺中市大里國民暨兒童運動中心」），就據此補 city。
      // 這是從既有欄位推導的事實，不是猜測；名錄查不到的新場館只能靠這個有縣市。
      const cityFromName = cityOf(venueName.match(/^(..[市縣])/)?.[1]);
      const prev = venues.get(venueId) ?? {
        id: venueId, name: venueName, address: null, source: 'derived',
        city: cityOf(loc.city) ?? cityFromName, district: loc.district ?? null,
        lat: null, lng: null, courseCount: 0,
      };
      prev.courseCount += 1;
      venues.set(venueId, prev);
    } else {
      stats.dangling += 1;
    }

    relations.push({
      fromKind: 'course',
      fromId: cluster.id,
      predicate: 'heldAt',
      toKind: 'venue',
      toId: venueId,
      toNameRaw: venueName || loc.address || '',
      toHint: {
        city: cityOf(loc.city),
        // 場館解出來的行政區優先：course.venue 在沒有場館時只剩這個 hint 可用（見 emit.mjs）
        district: (venueId ? venues.get(venueId)?.district : null) ?? loc.district ?? null,
        lat: venueId ? (venues.get(venueId)?.lat ?? null) : null,
        lng: venueId ? (venues.get(venueId)?.lng ?? null) : null,
      },
      state: venueId ? 'resolved' : 'dangling',
      method,
      confidence,
      updatedAt: today,
    });
  }

  const venueList = [...venues.values()].sort((a, b) => a.id.localeCompare(b.id));
  relations.sort((a, b) => a.fromId.localeCompare(b.fromId));
  await mkdir(path.dirname(VENUES_OUT), { recursive: true });
  await writeFile(VENUES_OUT, `${venueList.map((v) => JSON.stringify(v)).join('\n')}\n`, 'utf-8');
  await writeFile(RELATIONS_OUT, `${relations.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf-8');

  const withCoords = venueList.filter((v) => v.lat !== null).length;
  process.stderr.write(
    `cluster ${clusters.length} 群 → 邊 ${relations.length} 條\n`
    + `場館 ${venueList.length} 個（有座標 ${withCoords}）\n`
    + `邊的解析方式：${JSON.stringify(stats)}\n`,
  );
  if (geocoded.size === 0) {
    process.stderr.write('（geocode/out/geocoded.csv 還沒有資料，座標全缺是預期的）\n');
  }
}

if (process.argv[1] === path.join(ROOT, 'transform', 'resolve-relations.mjs')) await main();
