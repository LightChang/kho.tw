// transform/scheduler.mjs
// 排程邏輯在程式裡，不在觸發器裡（沿用 seh.tw docs/scheduling.md §3）。
// 外部只需要「每小時醒來一次」跑這支：它讀 data/schedule-state.json，挑出到期的來源去抓，
// 依內容有沒有變調整下次間隔，回報這輪有沒有任何來源變動（給後續 pipeline 判斷要不要 build）。
//
// 用法：
//   node transform/scheduler.mjs              抓所有到期來源
//   node transform/scheduler.mjs --list       只列出誰到期，不抓
//   node transform/scheduler.mjs --force <id> 強制重抓單一來源
//   node transform/scheduler.mjs --dry-run    照常抓，但不寫 state（開發用）
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { writeRawAndReport } from '../ingest/sources/_util.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const SOURCES_DIR = path.join(ROOT, 'ingest', 'sources');
const STATE_PATH = path.join(ROOT, 'data', 'schedule-state.json');

const HOUR = 3600_000;
const DAY = 24 * HOUR;

// 見 ingest/CONTRACT.md §3
export const CADENCE = {
  'course-live': { initial: 6 * HOUR, min: 3 * HOUR, max: DAY },
  'course-archive': { initial: 7 * DAY, min: 3 * DAY, max: 14 * DAY },
  registry: { initial: 14 * DAY, min: 7 * DAY, max: 30 * DAY },
  'opendata-monthly': { initial: 3 * DAY, min: DAY, max: 7 * DAY },
};
const HARD_MAX = 30 * DAY;      // 停更來源的硬上限，永不完全放棄
const UNCHANGED_BREAKOUT = 10;  // 連續幾次沒變才允許突破 max
const DOMAIN_GAP_MS = 2000;     // 同網域兩次請求的最小間隔
const DOMAIN_CONCURRENCY = 4;

const ms = (v) => (typeof v === 'number' ? v : 0);
export const fmt = (msVal) => {
  if (msVal % DAY === 0) return `${msVal / DAY}d`;
  if (msVal >= DAY) return `${(msVal / DAY).toFixed(1)}d`;
  if (msVal % HOUR === 0) return `${msVal / HOUR}h`;
  if (msVal >= HOUR) return `${(msVal / HOUR).toFixed(1)}h`;
  return `${Math.round(msVal / 60000)}m`;
};

// 報名季：boostMonths 命中的月份，初始間隔與下限減半
export function bounds(cadence, now = new Date()) {
  const base = CADENCE[cadence?.kind] ?? CADENCE['course-live'];
  const boosted = (cadence?.boostMonths ?? []).includes(now.getMonth() + 1);
  return boosted
    ? { initial: base.initial / 2, min: base.min / 2, max: base.max }
    : base;
}

export function nextInterval({ changed, failed, interval, unchangedRuns, cadence, now }) {
  const { min, max } = bounds(cadence, now);
  if (failed) return interval;                        // 失敗不改間隔，只累積失敗次數
  // 有變 → 加快。曾經突破 max 沉下去的停更來源，一有變動就要夾回 min/max 範圍內，
  // 不能只折半（5.1d 折半仍是 2.5d，還在 course-live 的 1d 上限之外）。
  if (changed) return Math.min(max, Math.max(min, interval / 2));
  const grown = interval * 1.5;
  // 連續 10 次沒變的來源允許突破 max，一路沉到硬上限；一有變動就會被上面那行拉回範圍內
  const ceiling = unchangedRuns >= UNCHANGED_BREAKOUT ? HARD_MAX : max;
  return Math.min(ceiling, grown);
}

async function loadSources() {
  const files = (await readdir(SOURCES_DIR)).filter((f) => f.endsWith('.mjs') && !f.startsWith('_'));
  const mods = [];
  for (const f of files) {
    const mod = await import(path.join(SOURCES_DIR, f));
    if (!mod.meta?.id || typeof mod.fetchRaw !== 'function') {
      process.stderr.write(`跳過 ${f}：缺 meta.id 或 fetchRaw\n`);
      continue;
    }
    mods.push(mod);
  }
  return mods.sort((a, b) => a.meta.id.localeCompare(b.meta.id));
}

async function loadState() {
  try {
    return JSON.parse(await readFile(STATE_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

async function saveState(state) {
  await mkdir(path.dirname(STATE_PATH), { recursive: true });
  const ordered = {};
  for (const k of Object.keys(state).sort()) ordered[k] = state[k];
  await writeFile(STATE_PATH, `${JSON.stringify(ordered, null, 2)}\n`, 'utf-8');
}

function hostOf(meta) {
  try {
    return new URL(meta.homepage ?? meta.endpoints?.[0] ?? 'https://example.invalid').host;
  } catch {
    return 'unknown';
  }
}

export function isDue(entry, now) {
  if (!entry?.nextDueAt) return true;
  return new Date(entry.nextDueAt).getTime() <= now.getTime();
}

async function runOne(mod, state, now, dryRun) {
  const { meta } = mod;
  const prev = state[meta.id] ?? {};
  const interval = ms(prev.intervalMs) || bounds(meta.cadence, now).initial;
  const started = Date.now();
  let changed = false;
  let failed = false;
  let count = null;
  let hash = prev.contentHash ?? null;

  try {
    const records = await mod.fetchRaw();
    count = Array.isArray(records) ? records.length : 0;
    hash = createHash('sha256').update(JSON.stringify(records)).digest('hex');
    changed = hash !== prev.contentHash;
    if (!dryRun) await writeRawAndReport(meta, records);
  } catch (err) {
    failed = true;
    process.stderr.write(`[${meta.id}] 失敗：${err.message}\n`);
  }

  const unchangedRuns = failed ? (prev.unchangedRuns ?? 0) : changed ? 0 : (prev.unchangedRuns ?? 0) + 1;
  const nextMs = nextInterval({ changed, failed, interval, unchangedRuns, cadence: meta.cadence, now });
  const nowIso = now.toISOString();
  state[meta.id] = {
    name: meta.name,
    kind: meta.cadence?.kind ?? 'course-live',
    declaredFreq: meta.updateFreq ?? 'UNVERIFIED',
    intervalMs: nextMs,
    interval: fmt(nextMs),
    lastFetchedAt: failed ? (prev.lastFetchedAt ?? null) : nowIso,
    lastChangedAt: changed ? nowIso : (prev.lastChangedAt ?? null),
    nextDueAt: new Date(now.getTime() + nextMs).toISOString(),
    recordCount: count ?? prev.recordCount ?? null,
    contentHash: hash,
    unchangedRuns,
    consecutiveFailures: failed ? (prev.consecutiveFailures ?? 0) + 1 : 0,
  };
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  const status = failed ? '失敗' : changed ? '有變動' : '無變動';
  process.stderr.write(
    `[${meta.id}] ${status}　${count ?? '-'} 筆　${secs}s　下次 ${fmt(nextMs)} 後\n`,
  );
  return { changed, failed };
}

async function main() {
  const args = process.argv.slice(2);
  const listOnly = args.includes('--list');
  const dryRun = args.includes('--dry-run');
  const forceIdx = args.indexOf('--force');
  const forceId = forceIdx >= 0 ? args[forceIdx + 1] : null;

  const now = new Date();
  const mods = await loadSources();
  const state = await loadState();

  let due = mods.filter((m) => isDue(state[m.meta.id], now));
  if (forceId) {
    due = mods.filter((m) => m.meta.id === forceId);
    if (due.length === 0) throw new Error(`找不到來源 ${forceId}`);
  }

  if (listOnly) {
    for (const m of mods) {
      const e = state[m.meta.id];
      const mark = isDue(e, now) ? '到期' : `等到 ${e.nextDueAt}`;
      process.stdout.write(`${m.meta.id}\t${m.meta.cadence?.kind ?? '-'}\t${mark}\n`);
    }
    return;
  }

  if (due.length === 0) {
    process.stderr.write('沒有到期的來源\n');
    return;
  }

  // 同網域序列執行、間隔 2 秒；不同網域併行，上限 4
  const byHost = new Map();
  for (const m of due) {
    const h = hostOf(m.meta);
    if (!byHost.has(h)) byHost.set(h, []);
    byHost.get(h).push(m);
  }
  const queues = [...byHost.values()];
  let anyChanged = false;
  let failures = 0;
  let cursor = 0;
  const workers = Array.from({ length: Math.min(DOMAIN_CONCURRENCY, queues.length) }, async () => {
    while (cursor < queues.length) {
      const queue = queues[cursor++];
      for (const [i, mod] of queue.entries()) {
        if (i > 0) await new Promise((r) => setTimeout(r, DOMAIN_GAP_MS));
        const { changed, failed } = await runOne(mod, state, now, dryRun);
        anyChanged ||= changed;
        if (failed) failures += 1;
      }
    }
  });
  await Promise.all(workers);

  if (!dryRun) await saveState(state);
  process.stderr.write(`\n本輪 ${due.length} 支，變動 ${anyChanged ? '有' : '無'}，失敗 ${failures} 支\n`);
  // 給後續 pipeline 判斷要不要跑 build：2 = 沒有任何變動，0 = 有變動，1 = 例外
  process.exitCode = anyChanged ? 0 : 2;
}

if (process.argv[1] === path.join(ROOT, 'transform', 'scheduler.mjs')) await main();
