// 圖片課表的視覺抽取：新莊、中和、五股國民運動中心只公開圖片（或圖片轉成的 PDF）課表，
// 沒有文字層可解析。這裡把一份課表（一篇公告的全部圖片、或一份 PDF 的全部頁面）交給主機上的
// headless claude 讀圖，回傳固定 schema 的 JSON，再用程式驗證。
//
// 成本控制：以「全部頁面內容的 sha256」當快取鍵，結果存在 data/vision-cache/<來源>/<鍵>.json，
// 隨觀測軌跡一起進版控（ops/run-host.sh 會 git add data/）。圖片沒換就不會再呼叫 claude，
// 重跑、換機器都免費。
//
// 失敗一律保守（fail closed）：
//   - claude 呼叫失敗 → 不寫快取，這份課表退回上一次通過驗證的結果（last-good.json）；
//   - 回傳沒通過 validateExtraction → 把退件原因寫進快取（同一組圖片不再重讀，免得每輪燒額度），
//     同樣退回上一次的結果。要強迫重讀：KHO_VISION_RETRY=1。
//   沒有上一次結果的新課表就先不收，等下一張圖或人工處理，不會把沒驗過的東西送上站。
//
// 呼叫方式沿用 seo-ops 大腦層（/mnt/yao-care/seo-ops/bin/seo-brain.sh）：主機的 claude CLI、
// 預設設定目錄；只開 Read 工具，工作目錄是放圖片的暫存目錄。
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const CACHE_ROOT = path.join(ROOT, 'data', 'vision-cache');
const CLAUDE = process.env.KHO_CLAUDE_BIN || '/root/.local/bin/claude';
const MODEL = process.env.KHO_VISION_MODEL || 'opus';
const TIMEOUT_MS = 20 * 60_000;

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

const nullable = (type) => ({ type: [type, 'null'] });
export const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['isTimetable', 'periodStartMonth', 'periodEndMonth', 'courses'],
  properties: {
    isTimetable: { type: 'boolean' },
    periodStartMonth: nullable('string'),
    periodEndMonth: nullable('string'),
    courses: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'title', 'category', 'section', 'weekdays', 'startTime', 'endTime', 'startDate', 'endDate',
          'sessions', 'price', 'teacher', 'place', 'audience', 'capacityText', 'note', 'page'],
        properties: {
          code: nullable('string'),
          title: { type: 'string' },
          category: nullable('string'),
          section: nullable('string'),
          weekdays: { type: 'array', items: { type: 'integer' } },
          startTime: { type: 'string' },
          endTime: nullable('string'),
          startDate: nullable('string'),
          endDate: nullable('string'),
          sessions: nullable('integer'),
          price: nullable('integer'),
          teacher: nullable('string'),
          place: nullable('string'),
          audience: nullable('string'),
          capacityText: nullable('string'),
          note: nullable('string'),
          page: { type: 'integer' },
        },
      },
    },
  },
};

export function buildPrompt({ venue, context, yearHint, files }) {
  return `你是資料抽取程式。請用 Read 工具依序讀取下列圖片，它們是「${venue}」公布的同一份課程簡章／課表的各頁：
${files.map((f, i) => `  第 ${i + 1} 頁：${f}`).join('\n')}
${context ? `\n背景：${context}\n` : ''}
把圖上「有固定星期與時段、按期開課」的每一門課逐一列出，一個班別一筆（同一課程名稱但代號、星期或時段不同就是不同筆）。
規則：
- 只寫圖上明確寫出的內容，不要推測；圖上沒有的欄位填 null。看不清楚的字寧可整筆不列，也不要猜。
- weekdays：上課星期，1＝週一 … 7＝週日。表格用欄或列表示星期時，照該格所在的星期。
- startTime／endTime：24 小時制 HH:MM（例如 "19:00"）。
- startDate／endDate：該班的上課起訖日，YYYY-MM-DD。圖上只寫「9/7-10/26」時，年份用圖上寫的年份（民國 115 年＝2026 年）；
  整份簡章都沒寫年份才用 ${yearHint}。圖上沒寫該班的起訖日就填 null，不要用期別月份自己湊日期。
- periodStartMonth／periodEndMonth：整份簡章標示的期間（例如「2026.11-12月」→ "2026-11"、"2026-12"），沒寫就 null。
- code：課程代號／編號（如 "SK317"、"X119"），沒有就 null。
- title：課程名稱原文（如「兒童班」「TRX 基礎肌力」）；同一格若標了對象或程度（如「一～九年級」「幼兒」），放 audience。
- category：這門課的運動項目。優先照圖上的簡章標題或表格標題（如「游泳課程」「TRX 懸吊課程」「瑜珈」）；
  圖上沒有文字寫明項目時，可依頁面上明確的畫面判斷（例如泳池、泳圈插圖配上幼兒班／兒童班課表 → 「游泳」），完全無從判斷才填 null。
- section：該課所在的表格或區塊標題原文（如「平日週一班」「幼兒泳訓專班」），沒有就 null。
- sessions：堂數（整數）；price：這一期的總費用（新台幣整數，不含「元」與逗號）；單堂體驗價不算 price，可寫進 note。
- teacher：教練名；place：上課地點／教室；capacityText：人數原文（如「7-10 人」）；note：停課日、備註原文。
- page：這筆出現在第幾頁（從 1 起算）。
- 報名須知、收費說明、場地租借、單堂體驗表、一對一或「時間由教練與學員協調」的課，不要列。
- 如果這些圖根本不是課表，isTimetable 填 false、courses 給空陣列。
只輸出符合 schema 的 JSON。`;
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const minutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const dayMs = 86_400_000;

// 驗證抽取結果。回傳 { ok, errors, warnings, courses }；courses 只留通過逐筆檢查的列。
// 整份退件的條件：沒有課、單筆錯誤過多、或「起始日的星期」與表上星期對不起來的比例過高
// （讀錯日期或讀錯欄位時最先露餡的就是這個）。
export function validateExtraction(result, { today = new Date(), maxCourses = 400 } = {}) {
  const errors = [];
  const warnings = [];
  if (!result || typeof result !== 'object' || !Array.isArray(result.courses)) {
    return { ok: false, errors: ['回傳不是 { courses: [] } 形狀'], warnings, courses: [] };
  }
  if (result.isTimetable === false) {
    return { ok: result.courses.length === 0, errors: result.courses.length ? ['isTimetable=false 卻有課'] : [], warnings, courses: [] };
  }
  for (const k of ['periodStartMonth', 'periodEndMonth']) {
    if (result[k] != null && !/^\d{4}-(0[1-9]|1[0-2])$/.test(result[k])) errors.push(`${k} 格式錯：${result[k]}`);
  }
  const lo = today.getTime() - 400 * dayMs;
  const hi = today.getTime() + 400 * dayMs;
  const good = [];
  let bad = 0;
  let weekdayChecked = 0;
  let weekdayMismatch = 0;
  for (const c of result.courses) {
    const why = [];
    if (!c.title || !String(c.title).trim()) why.push('沒有課名');
    if (!Array.isArray(c.weekdays) || !c.weekdays.length || c.weekdays.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) why.push(`星期不合理 ${JSON.stringify(c.weekdays)}`);
    if (!HHMM.test(c.startTime ?? '')) why.push(`開始時間格式 ${c.startTime}`);
    if (c.endTime != null && !HHMM.test(c.endTime)) why.push(`結束時間格式 ${c.endTime}`);
    if (HHMM.test(c.startTime ?? '') && HHMM.test(c.endTime ?? '')) {
      const len = minutes(c.endTime) - minutes(c.startTime);
      if (len < 20 || len > 240) why.push(`時長 ${len} 分鐘`);
      if (minutes(c.startTime) < 5 * 60) why.push(`開始時間 ${c.startTime} 太早`);
    }
    const dates = {};
    for (const k of ['startDate', 'endDate']) {
      if (c[k] == null) continue;
      const m = String(c[k]).match(DATE);
      const t = m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
      if (!m || Number.isNaN(t) || new Date(t).getUTCDate() !== +m[3]) why.push(`${k} 格式 ${c[k]}`);
      else if (t < lo || t > hi) why.push(`${k} ${c[k]} 離今天超過 400 天`);
      else dates[k] = t;
    }
    if (dates.startDate && dates.endDate) {
      const span = (dates.endDate - dates.startDate) / dayMs;
      if (span < 0 || span > 200) why.push(`起訖跨 ${span} 天`);
    }
    if (c.sessions != null && (!Number.isInteger(c.sessions) || c.sessions < 1 || c.sessions > 60)) why.push(`堂數 ${c.sessions}`);
    if (c.price != null && (!Number.isInteger(c.price) || c.price < 0 || c.price > 100000)) why.push(`費用 ${c.price}`);
    if (why.length) {
      bad++;
      warnings.push(`${c.code ?? ''} ${c.title ?? ''}：${why.join('、')}`);
      continue;
    }
    if (dates.startDate && c.weekdays.length === 1) {
      weekdayChecked++;
      const dow = new Date(dates.startDate).getUTCDay() || 7;
      if (dow !== c.weekdays[0]) {
        weekdayMismatch++;
        warnings.push(`${c.code ?? ''} ${c.title}：起始日 ${c.startDate} 是星期 ${dow}，表上寫星期 ${c.weekdays[0]}`);
      }
    }
    good.push(c);
  }
  if (!good.length) errors.push('沒有任何一筆通過檢查');
  if (result.courses.length > maxCourses) errors.push(`筆數 ${result.courses.length} 超過上限 ${maxCourses}`);
  if (bad > Math.max(2, result.courses.length * 0.1)) errors.push(`${bad}/${result.courses.length} 筆沒通過逐筆檢查`);
  if (weekdayChecked >= 3 && weekdayMismatch > weekdayChecked * 0.2) {
    errors.push(`起始日星期對不上 ${weekdayMismatch}/${weekdayChecked}`);
  }
  return { ok: errors.length === 0, errors, warnings, courses: good };
}

function runClaude(prompt, cwd) {
  return new Promise((resolve, reject) => {
    const args = ['-p', prompt, '--model', MODEL, '--output-format', 'json',
      '--json-schema', JSON.stringify(SCHEMA), '--allowedTools', 'Read'];
    const child = spawn(CLAUDE, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), TIMEOUT_MS);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`claude 退出碼 ${code}：${(err || out).slice(0, 300)}`));
      try {
        const env = JSON.parse(out);
        if (env.is_error) return reject(new Error(`claude 回報錯誤：${String(env.result).slice(0, 300)}`));
        const data = env.structured_output ?? JSON.parse(String(env.result).replace(/^```(?:json)?\s*|\s*```$/g, ''));
        resolve({ data, costUsd: env.total_cost_usd ?? null });
      } catch (e) {
        reject(new Error(`claude 輸出不是 JSON：${e.message}；${out.slice(0, 300)}`));
      }
    });
  });
}

async function readJson(file) {
  try { return JSON.parse(await readFile(file, 'utf-8')); } catch { return null; }
}

// pages：[{ buf, ext }]，依頁序。keyBufs（選填）是算快取鍵用的原始檔：PDF 轉出來的頁面圖
// 會隨 pdftoppm 版本變，快取鍵改用 PDF 本身，才不會換了工具就全部重讀。
// 回傳 { courses, periodStartMonth, periodEndMonth, hash }；沒有可用結果時回傳 null。
export async function extractTimetable({ sourceId, docKey, venue, pages, keyBufs, context = '', today = new Date() }) {
  const dir = path.join(CACHE_ROOT, sourceId);
  await mkdir(dir, { recursive: true });
  const hash = sha256(Buffer.concat((keyBufs ?? pages.map((p) => p.buf)).map((b) => Buffer.from(sha256(b)))));
  const cacheFile = path.join(dir, `${hash}.json`);
  const lastGoodFile = path.join(dir, 'last-good.json');
  const lastGood = (await readJson(lastGoodFile)) ?? {};
  const log = (msg) => process.stderr.write(`[${sourceId}] ${docKey} ${msg}\n`);

  const fallback = async (why) => {
    const prevHash = lastGood[docKey];
    const prev = prevHash && prevHash !== hash ? await readJson(path.join(dir, `${prevHash}.json`)) : null;
    if (prev?.status === 'ok') {
      log(`${why}；沿用上一次通過驗證的結果（${prevHash.slice(0, 12)}）`);
      return { ...prev.result, courses: prev.courses, hash: prevHash };
    }
    log(`${why}；沒有上一次的結果，這份先不收`);
    return null;
  };

  let entry = await readJson(cacheFile);
  if (entry?.status === 'rejected' && process.env.KHO_VISION_RETRY === '1') entry = null;
  if (!entry) {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'kho-vision-'));
    try {
      const files = [];
      for (const [i, p] of pages.entries()) {
        const name = `page-${i + 1}.${p.ext}`;
        await writeFile(path.join(tmp, name), p.buf);
        files.push(path.join(tmp, name));
      }
      const yearHint = String(new Date(today.getTime() + 8 * 3600_000).getUTCFullYear());
      log(`讀圖中（${pages.length} 頁，model=${MODEL}）`);
      let res;
      try {
        res = await runClaude(buildPrompt({ venue, context, yearHint, files }), tmp);
      } catch (e) {
        return fallback(`視覺抽取失敗：${e.message}`);
      }
      const v = validateExtraction(res.data, { today });
      entry = {
        hash, docKey, venue, extractedAt: new Date().toISOString(), model: MODEL, costUsd: res.costUsd,
        status: v.ok ? 'ok' : 'rejected', errors: v.errors, warnings: v.warnings,
        result: { isTimetable: res.data?.isTimetable, periodStartMonth: res.data?.periodStartMonth ?? null, periodEndMonth: res.data?.periodEndMonth ?? null },
        courses: v.ok ? v.courses : res.data?.courses ?? [],
      };
      await writeFile(cacheFile, `${JSON.stringify(entry, null, 1)}\n`, 'utf-8');
      log(`${entry.status}：${entry.courses.length} 筆${v.errors.length ? `；${v.errors.join('；')}` : ''}`);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }
  if (entry.status !== 'ok') return fallback(`這組圖片的抽取結果沒通過驗證（${entry.errors.join('；')}）`);
  if (lastGood[docKey] !== hash) {
    lastGood[docKey] = hash;
    const ordered = Object.fromEntries(Object.keys(lastGood).sort().map((k) => [k, lastGood[k]]));
    await writeFile(lastGoodFile, `${JSON.stringify(ordered, null, 1)}\n`, 'utf-8');
  }
  return { ...entry.result, courses: entry.courses, hash };
}
