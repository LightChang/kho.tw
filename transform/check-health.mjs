// transform/check-health.mjs
// 讀 data/observation/*.ndjson，比對歷史筆數，異常就非零退出（不要進 build）。
//
// 和 seh.tw 的差別：課程是期別制，會有季節性斷崖——學期中穩定、期末歸零、開報名日暴增。
// 所以「掉超過 30% 就擋」對本專案是錯的規則。改成：
//   1. 掛零（且上次不是零）→ 一律失敗，不分期別
//   2. 掉幅 > 50%，且不在期別切換窗口 → 失敗
//   3. 掉幅 > 50%，但在期別切換窗口 → 警告，不擋
//   4. 和去年同期比（有資料時）掉超過 50% → 失敗，不管在不在窗口
// 期別切換窗口取自實測：社大春季班 1-2 月、秋季班 7-8 月換期；運動中心雙月期別，
// 每單數月初換期，所以運動中心類來源的窗口是每個單數月的 1-10 日。
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { todayTaipei } from './_date.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const OBS_DIR = path.join(ROOT, 'data', 'observation');
const HISTORY = path.join(ROOT, 'data', 'health-history.json');

const DROP_LIMIT = 0.5;

export function inTermWindow(sourceId, date = new Date()) {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  if (sourceId === 'xuanen-centers') return month % 2 === 1 && day <= 10;
  return [1, 2, 7, 8].includes(month);
}

async function activeCounts() {
  let files = [];
  try {
    files = (await readdir(OBS_DIR)).filter((f) => f.endsWith('.ndjson'));
  } catch {
    return {};
  }
  const counts = {};
  for (const f of files) {
    const text = await readFile(path.join(OBS_DIR, f), 'utf-8');
    const rows = text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
    counts[f.replace(/\.ndjson$/, '')] = rows.filter((r) => !r.disappearedAt).length;
  }
  return counts;
}

async function loadHistory() {
  try {
    return JSON.parse(await readFile(HISTORY, 'utf-8'));
  } catch {
    return {};
  }
}

export function judge(sourceId, current, history, now = new Date()) {
  const entries = Object.entries(history?.[sourceId] ?? {}).sort();
  if (entries.length === 0) return { level: 'ok', msg: '首次記錄' };
  const [, prev] = entries[entries.length - 1];
  const drop = prev > 0 ? (prev - current) / prev : 0;

  if (current === 0 && prev > 0) return { level: 'fail', msg: `掛零（前次 ${prev}）` };

  // 去年同期（±10 天內最接近的一筆）
  const target = new Date(now.getTime());
  target.setFullYear(target.getFullYear() - 1);
  const lastYear = entries
    .map(([d, v]) => [Math.abs(new Date(d) - target), v])
    .filter(([diff]) => diff <= 10 * 86400_000)
    .sort((a, b) => a[0] - b[0])[0];
  if (lastYear && lastYear[1] > 0) {
    const yoy = (lastYear[1] - current) / lastYear[1];
    if (yoy > DROP_LIMIT) {
      return { level: 'fail', msg: `比去年同期少 ${(yoy * 100).toFixed(0)}%（${lastYear[1]} → ${current}）` };
    }
  }

  if (drop > DROP_LIMIT) {
    return inTermWindow(sourceId, now)
      ? { level: 'warn', msg: `掉 ${(drop * 100).toFixed(0)}%（${prev} → ${current}），在期別切換窗口，不擋` }
      : { level: 'fail', msg: `掉 ${(drop * 100).toFixed(0)}%（${prev} → ${current}），不在期別切換窗口` };
  }
  return { level: 'ok', msg: `${prev} → ${current}` };
}

async function main() {
  const now = new Date();
  const today = todayTaipei(now);
  const counts = await activeCounts();
  const history = await loadHistory();
  let failed = 0;

  for (const [sourceId, current] of Object.entries(counts).sort()) {
    const { level, msg } = judge(sourceId, current, history, now);
    process.stderr.write(`[${level.toUpperCase()}] ${sourceId}　${current} 筆　${msg}\n`);
    if (level === 'fail') failed += 1;
    history[sourceId] = { ...(history[sourceId] ?? {}), [today]: current };
  }

  await mkdir(path.dirname(HISTORY), { recursive: true });
  const ordered = {};
  for (const k of Object.keys(history).sort()) {
    const days = {};
    for (const d of Object.keys(history[k]).sort()) days[d] = history[k][d];
    ordered[k] = days;
  }
  await writeFile(HISTORY, `${JSON.stringify(ordered, null, 2)}\n`, 'utf-8');

  if (failed > 0) {
    process.stderr.write(`\n${failed} 支來源異常，不進 build\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] === path.join(ROOT, 'transform', 'check-health.mjs')) await main();
