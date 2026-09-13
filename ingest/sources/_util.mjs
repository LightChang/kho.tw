// 共用的 fetch／解析工具。不屬於 contract 規定的檔案，各 source script 自行 import。
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

export const UA = 'kho.tw-ingest/0.1 (+https://kho.tw)';
const TIMEOUT_MS = 90_000;

export async function fetchWithRetry(url, options = {}, retries = 2) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        ...options,
        headers: { 'User-Agent': UA, ...(options.headers || {}) },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  throw lastErr;
}

// form-urlencoded POST，回傳文字
export async function postForm(url, fields, options = {}) {
  const body = new URLSearchParams(fields).toString();
  const res = await fetchWithRetry(url, {
    ...options,
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(options.headers || {}) },
    body,
  });
  return res.text();
}

// 部分政府站回傳 BOM 或前置空白，JSON.parse 會爆
export function parseJsonLoose(text) {
  const t = text.replace(/^﻿/, '').trim();
  if (!t) return [];
  return JSON.parse(t);
}

// 極簡 CSV parser：處理雙引號欄位、欄位內換行、逗號。不做型別轉換。
export function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* 由 \n 處理 */ }
    else if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
    else field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

export function csvToObjects(text) {
  const rows = parseCsvRows(text);
  if (rows.length === 0) return [];
  const header = rows[0];
  return rows.slice(1).map((r) => {
    const obj = {};
    header.forEach((h, i) => { obj[h] = r[i] ?? ''; });
    return obj;
  });
}

// HTML 取純文字（去標籤、解實體、壓空白）。只給欄位抽取用，不是通用解析器。
// 各種空白實體都要處理：新北樂學網用的是 &numsp;（U+2007），只解 &nbsp; 會把它留在欄位值裡。
const SPACE_ENTITIES = /&(nbsp|ensp|emsp|emsp13|emsp14|numsp|puncsp|thinsp|hairsp|zwnj|zwj);/gi;

export function htmlText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(SPACE_ENTITIES, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[  -​　]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function writeRawAndReport(meta, records) {
  const dir = path.resolve(import.meta.dirname, '..', 'raw');
  await mkdir(dir, { recursive: true });
  const outPath = path.join(dir, `${meta.id}.json`);
  await writeFile(outPath, JSON.stringify(records, null, 2), 'utf-8');
  process.stderr.write(`[${meta.id}] ${records.length} 筆 -> ${outPath}\n`);
  return outPath;
}

// 供 CLI 單獨執行用：node ingest/sources/<id>.mjs
export async function runAsScript(importMetaUrl, meta, fetchRaw) {
  const { fileURLToPath } = await import('node:url');
  if (process.argv[1] !== fileURLToPath(importMetaUrl)) return;
  const records = await fetchRaw();
  await writeRawAndReport(meta, records);
}
