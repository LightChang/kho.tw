// transform/cluster.mjs
// L2 分群：把「同一門課在不同來源的觀測」收成一群（規則與 confidence 見下）。
// 沿用 seh.tw ARCHITECTURE.md §3 的可逆分群——分群是「哪些 observation 屬於同一個真實事物」，
// 錯了把成員移出去就好，cluster id 不變、網址不斷。
//
// 規則（由強到弱，先命中先合併）：
//   1.0  校名 ＋ 期別 ＋ 校內課程代碼    實測北市聯網 code 與教育部 internal_course_code 同值
//   0.9  校名 ＋ 期別 ＋ 正規化課名 ＋ 星期 ＋ 開始時刻
//   0.8  校名 ＋ 期別 ＋ 正規化課名 ＋ 教師
//   —    其餘自成一群
//
// 輸出 data/clusters.ndjson，依 id 排序；id 取群內字典序最小的 observationId，
// 與處理順序無關，重跑結果相同。
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { todayTaipei } from './_date.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const OBS_DIR = path.join(ROOT, 'data', 'observation');
const OUT = path.join(ROOT, 'data', 'clusters.ndjson');

const FULLWIDTH = /[！-～]/g;
const toHalf = (s) => s.replace(FULLWIDTH, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

// 「臺北市松山社區大學」「松山社大」「台北市松山社區大學」要視為同一所
export function normSchool(raw) {
  return toHalf(String(raw ?? ''))
    .replace(/台/g, '臺')
    .replace(/\s+/g, '')
    .replace(/^(臺北市|新北市|桃園市|臺中市|臺南市|高雄市|基隆市|新竹市|新竹縣|嘉義市|嘉義縣|苗栗縣|彰化縣|南投縣|雲林縣|屏東縣|宜蘭縣|花蓮縣|臺東縣|澎湖縣|金門縣|連江縣)/, '')
    .replace(/(社區大學|社大|樂齡學習中心|樂齡中心|國民運動中心|運動中心)$/, '')
    .trim();
}

// 「【11/18開課】抒壓玩水彩（六週）」→「抒壓玩水彩」
export function normTitle(raw) {
  return toHalf(String(raw ?? ''))
    .replace(/^【[^】]*】/, '')
    .replace(/[（(][^）)]*[週期班]\s*[）)]/g, '')
    .replace(/[\s　]+/g, '')
    .replace(/[★☆◎※*]/g, '')
    .replace(/[，,。.、:：;；!！?？~～\-－—_]/g, '')
    .trim();
}

const termKey = (t) => (t?.year && t?.season ? `${t.year}${t.season}` : (t?.raw ?? '').replace(/\s+/g, ''));

// 職訓三支（taiwanjobs、mol-6060、mol-6614）共用同一個 ID 空間：台灣就業通的
// SourcePrimaryKey、6060「網址」欄位裡的 Course/Detail?ID=<課程編號>、6614 的 OCID 是同一組。
// 漏掉 taiwanjobs 這個鍵的話，職訓類的跨來源分群從頭到尾不會觸發——不只新接的兩支，
// 既有的 2,396 門 taiwanjobs 也一樣沒被讀到（2026-09-13 發現）。
export function courseCodeOf(payload) {
  return payload.externalIds?.schoolCourseCode
    ?? payload.externalIds?.centerCourseCode
    ?? payload.externalIds?.taiwanjobs
    ?? null;
}

function keysOf(payload) {
  const school = normSchool(payload.provider?.nameRaw);
  const term = termKey(payload.term);
  const title = normTitle(payload.title);
  const slot = payload.schedule?.slots?.[0] ?? {};
  const teacher = normTitle(payload.teachers?.[0]?.nameRaw);
  const code = courseCodeOf(payload);
  const keys = [];
  if (school && code) {
    // 平台的週課表版沒有期別欄（1865/3406 筆缺），所以代碼規則不能強制要求期別
    if (term) keys.push({ rule: 'school-course-code', confidence: 1.0, key: `c|${school}|${term}|${code}` });
    keys.push({ rule: 'school-course-code-noterm', confidence: 0.95, key: `c0|${school}|${code}` });
  }
  if (school && term && title && slot.weekday && slot.startTime) {
    keys.push({ rule: 'title-slot', confidence: 0.9, key: `s|${school}|${term}|${title}|${slot.weekday}|${slot.startTime}` });
  }
  if (school && term && title && teacher) {
    // 同校同期同名同師但不同時段，是不同班次（實測林口運動中心「運動按摩」一期 51 個班次）。
    // 來源給得出時刻就必須連時刻一起比；只有完全沒有時刻的來源才退回純教師比對。
    if (slot.startTime) {
      keys.push({
        rule: 'title-teacher-slot',
        confidence: 0.85,
        key: `ts|${school}|${term}|${title}|${teacher}|${slot.weekday ?? ''}|${slot.startTime}`,
      });
    } else {
      // 沒有時刻的來源至少要比星期，否則同校同期同名同師的各班次會全部串在一起
      keys.push({
        rule: 'title-teacher',
        confidence: 0.8,
        key: `t|${school}|${term}|${title}|${teacher}|${slot.weekday ?? ''}`,
      });
    }
  }
  return keys;
}

// union-find
function makeDsu() {
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root);
    let cur = x;
    while (parent.get(cur) !== cur) {
      const next = parent.get(cur);
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    // 取字典序小的當根，讓結果與處理順序無關
    if (ra < rb) parent.set(rb, ra);
    else parent.set(ra, rb);
  };
  return { find, union };
}

async function loadObservations() {
  let files = [];
  try {
    files = (await readdir(OBS_DIR)).filter((f) => f.endsWith('.ndjson'));
  } catch {
    return [];
  }
  const rows = [];
  for (const f of files.sort()) {
    const text = await readFile(path.join(OBS_DIR, f), 'utf-8');
    for (const line of text.split('\n')) {
      if (!line) continue;
      const o = JSON.parse(line);
      if (o.disappearedAt) continue;
      if ((o.entityKind ?? 'course') !== 'course') continue; // 場館名錄不進課程分群
      rows.push(o);
    }
  }
  return rows;
}

export async function buildClusters(observations) {
  const dsu = makeDsu();
  const byKey = new Map();   // key -> 第一個看到的 observationId
  const evidence = new Map(); // observationId -> {rule, confidence}
  const codeOf = new Map();  // observationId -> 課程代碼（用來擋掉互相矛盾的合併）
  const sourceOf = new Map();
  for (const o of observations) {
    dsu.find(o.id);
    sourceOf.set(o.id, o.payload._source);
    const code = courseCodeOf(o.payload);
    if (code) codeOf.set(o.id, `${o.payload._source}|${code}`);
  }
  // 兩筆都有代碼且不同 → 是不同班次，不准合併（代碼是來源自己的身分，比課名可信）
  const conflicts = (a, b, confidence) => {
    const ca = codeOf.get(a);
    const cb = codeOf.get(b);
    if (ca && cb && ca !== cb && ca.split('|')[0] === cb.split('|')[0]) return true;
    // 同一個來源的兩筆、雙方都沒有代碼可資區分時，弱規則不要合併：
    // 同校同期同名的多筆通常是不同班次（實測竹北社大「伸展瑜珈初階」一期 6 班）。
    if (confidence <= 0.85 && !ca && !cb && sourceOf.get(a) === sourceOf.get(b)) return true;
    return false;
  };
  for (const o of observations.slice().sort((a, b) => a.id.localeCompare(b.id))) {
    for (const { rule, confidence, key } of keysOf(o.payload)) {
      const seen = byKey.get(key);
      if (seen === undefined) {
        byKey.set(key, o.id);
        continue;
      }
      if (confidence < 1.0 && conflicts(seen, o.id, confidence)) continue;
      dsu.union(seen, o.id);
      for (const id of [seen, o.id]) {
        const prev = evidence.get(id);
        if (!prev || prev.confidence < confidence) evidence.set(id, { rule, confidence });
      }
    }
  }
  const groups = new Map();
  for (const o of observations) {
    const root = dsu.find(o.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(o);
  }
  const today = todayTaipei();
  const clusters = [];
  for (const [root, members] of groups) {
    members.sort((a, b) => a.id.localeCompare(b.id));
    const slugSeed = createHash('sha256').update(root).digest('hex').slice(0, 8);
    clusters.push({
      // 可讀網址（slug）不在這一層產生：分群只知道「哪些觀測是同一門課」，
      // 課名與主辦單位的最終值要等 emit 投影完才定案。見 transform/slug.mjs。
      id: `crs_${slugSeed}`,
      entityKind: 'course',
      createdAt: today,
      title: members[0].payload.title,
      members: members.map((m) => ({
        observationId: m.id,
        source: m.payload._source,
        rule: evidence.get(m.id)?.rule ?? 'singleton',
        confidence: evidence.get(m.id)?.confidence ?? 1.0,
        addedAt: today,
      })),
    });
  }
  clusters.sort((a, b) => a.id.localeCompare(b.id));
  return clusters;
}

async function main() {
  const observations = await loadObservations();
  const clusters = await buildClusters(observations);
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, `${clusters.map((c) => JSON.stringify(c)).join('\n')}\n`, 'utf-8');

  const multi = clusters.filter((c) => new Set(c.members.map((m) => m.source)).size > 1);
  const byRule = {};
  for (const c of clusters) {
    for (const m of c.members) byRule[m.rule] = (byRule[m.rule] ?? 0) + 1;
  }
  process.stderr.write(
    `observation ${observations.length} 筆 → cluster ${clusters.length} 群\n`
    + `跨來源合併的群：${multi.length}\n`
    + `成員的合併依據：${JSON.stringify(byRule)}\n`,
  );
  const sample = multi.slice(0, 5).map((c) => `  ${c.title}｜${c.members.map((m) => m.source).join(' + ')}`);
  if (sample.length) process.stderr.write(`跨來源樣本：\n${sample.join('\n')}\n`);
}

if (process.argv[1] === path.join(ROOT, 'transform', 'cluster.mjs')) await main();
