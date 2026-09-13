// transform/normalize.mjs
// ingest/raw/<id>.json → data/staged/<id>.ndjson（L1）→ data/observation/<id>.ndjson（append-only）
//
// observation 的語意沿用 seh.tw ARCHITECTURE.md §2：
//   已存在且 hash 相同 → 只更新 lastVerifiedAt
//   已存在但 hash 不同 → 更新 payload、contentHash、lastChangedAt
//   不存在             → 新增，firstObservedAt = 今天
//   這次沒回傳的既有筆 → 設 disappearedAt，但不刪除
// 輸出必須穩定（欄位順序固定、依 id 排序），否則每天的 git diff 會是全量。
//
// 用法：node transform/normalize.mjs [source-id ...]（不給就跑 raw/ 底下全部）
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { todayTaipei } from './_date.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const RAW_DIR = path.join(ROOT, 'ingest', 'raw');
const STAGED_DIR = path.join(ROOT, 'data', 'staged');
const OBS_DIR = path.join(ROOT, 'data', 'observation');

const OBS_KEYS = ['id', 'sourceRecordId', 'entityKind', 'contentHash', 'firstObservedAt',
  'lastVerifiedAt', 'lastChangedAt', 'disappearedAt', 'sourceUpdatedAt', 'payload'];

// 固定鍵序輸出，讓同樣內容永遠產生同樣的位元組
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) {
      if (value[k] === undefined) continue;
      out[k] = stable(value[k]);
    }
    return out;
  }
  return value;
}

// 抓取時間每跑一次就不同，必須排除在雜湊之外，否則每次 normalize 都會把全部記錄
// 判成「內容有變」，lastChangedAt 失去意義、git diff 也會變成全量。
// observation 那層用 lastVerifiedAt 表達「最後一次確認它還在」，語意相同且只有日期。
const VOLATILE_KEYS = ['_fetchedAt'];

function withoutVolatile(payload) {
  const out = {};
  for (const [k, v] of Object.entries(payload)) {
    if (!VOLATILE_KEYS.includes(k)) out[k] = v;
  }
  return out;
}

const hashOf = (payload) =>
  createHash('sha256').update(JSON.stringify(stable(withoutVolatile(payload)))).digest('hex');

async function readNdjson(file) {
  try {
    const text = await readFile(file, 'utf-8');
    return text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

async function writeNdjson(file, rows) {
  await mkdir(path.dirname(file), { recursive: true });
  const body = rows.map((r) => JSON.stringify(r)).join('\n');
  await writeFile(file, body ? `${body}\n` : '', 'utf-8');
}

export async function normalizeSource(sourceId, today = todayTaipei()) {
  const rawPath = path.join(RAW_DIR, `${sourceId}.json`);
  const modPath = path.join(ROOT, 'transform', 'normalize', `${sourceId}.mjs`);
  let mod;
  try {
    mod = await import(modPath);
  } catch {
    process.stderr.write(`[${sourceId}] 還沒有 normalize 程式，跳過\n`);
    return null;
  }
  const records = JSON.parse(await readFile(rawPath, 'utf-8'));
  const fetchedAt = new Date().toISOString();
  // 名錄類來源產出的是場館／單位，不是課程；normalize 模組自己宣告 entityKind
  const entityKind = mod.entityKind ?? 'course';
  const staged = mod.normalize(records, { fetchedAt }).map(stable);

  const seen = new Map();
  for (const c of staged) {
    const id = `${sourceId}:${c._sourceRecordId}`;
    if (seen.has(id)) continue; // 同一筆在來源出現多次時只留第一筆
    seen.set(id, c);
  }
  const sorted = [...seen.values()].sort((a, b) =>
    String(a._sourceRecordId).localeCompare(String(b._sourceRecordId)));
  await writeNdjson(path.join(STAGED_DIR, `${sourceId}.ndjson`), sorted);

  const obsPath = path.join(OBS_DIR, `${sourceId}.ndjson`);
  const prev = new Map((await readNdjson(obsPath)).map((o) => [o.id, o]));
  const stats = { added: 0, changed: 0, verified: 0, disappeared: 0 };
  const next = [];
  for (const [id, payload] of seen) {
    const contentHash = hashOf(payload);
    const old = prev.get(id);
    const rec = {
      id,
      sourceRecordId: payload._sourceRecordId,
      entityKind,
      contentHash,
      firstObservedAt: old?.firstObservedAt ?? today,
      lastVerifiedAt: today,
      lastChangedAt: old && old.contentHash === contentHash ? old.lastChangedAt : today,
      disappearedAt: null,
      sourceUpdatedAt: payload.sourceUpdatedAt ?? null,
      payload: withoutVolatile(payload),
    };
    if (!old) stats.added += 1;
    else if (old.contentHash !== contentHash) stats.changed += 1;
    else stats.verified += 1;
    next.push(rec);
    prev.delete(id);
  }
  // 這次沒回傳的：標記消失，但保留
  for (const [, old] of prev) {
    next.push({ ...old, disappearedAt: old.disappearedAt ?? today });
    if (!old.disappearedAt) stats.disappeared += 1;
  }
  next.sort((a, b) => a.id.localeCompare(b.id));
  const ordered = next.map((r) => {
    const o = {};
    for (const k of OBS_KEYS) o[k] = r[k];
    return o;
  });
  await writeNdjson(obsPath, ordered);

  process.stderr.write(
    `[${sourceId}] L1 ${sorted.length} 筆｜新增 ${stats.added}、變動 ${stats.changed}、`
    + `未變 ${stats.verified}、消失 ${stats.disappeared}\n`,
  );
  return { sourceId, staged: sorted.length, ...stats };
}

async function main() {
  const args = process.argv.slice(2);
  let ids = args;
  if (ids.length === 0) {
    ids = (await readdir(RAW_DIR)).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
  }
  const results = [];
  for (const id of ids.sort()) {
    const r = await normalizeSource(id);
    if (r) results.push(r);
  }
  const total = results.reduce((n, r) => n + r.staged, 0);
  process.stderr.write(`\n共 ${results.length} 支來源、${total} 筆 L1\n`);
}

if (process.argv[1] === path.join(ROOT, 'transform', 'normalize.mjs')) await main();
