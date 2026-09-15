#!/usr/bin/env node
// 用 kho.tw 專屬的服務帳號操作 Search Console 與 Google Analytics Admin API。
//
//   node scripts/google.mjs check             列出服務帳號看得到的 GSC 資源、sitemap 與 GA 帳戶／資源
//   node scripts/google.mjs submit-sitemap    把 https://kho.tw/sitemap.xml 送進 sc-domain:kho.tw
//
// 憑證（服務帳號金鑰是機密，不可進版控），二選一：
//   KHO_GOOGLE_KEY_FILE=~/.config/kho-tw/kho-seo-key.json   本機用
//   KHO_GOOGLE_SA_JSON='{...}'                              CI 用，放 GitHub Secrets
//
// 服務帳號：kho-seo@kho-tw.iam.gserviceaccount.com（GCP 專案 kho-tw，已啟用
// searchconsole、analyticsadmin、analyticsdata 三個 API）。它要先被加進 Search Console
// 的 kho.tw 資源與 GA 帳戶，否則 API 回來的清單是空的——空清單不是錯誤，是還沒授權。
//
// 沒有第三方套件：JWT 用 node:crypto 自己簽，與 seh.tw 的 scripts/gsc-pull.mjs 同一套作法。
import { createSign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import os from 'node:os';

const PROPERTY = 'sc-domain:kho.tw';
const SITEMAP = 'https://kho.tw/sitemap.xml';
// webmasters（非 readonly）才能送 sitemap；analytics.edit 才能建 GA4 資源與資料串流
const SCOPES = [
  'https://www.googleapis.com/auth/webmasters',
  'https://www.googleapis.com/auth/analytics.edit',
].join(' ');

const b64url = (b) => Buffer.from(b).toString('base64url');

async function loadKey() {
  if (process.env.KHO_GOOGLE_SA_JSON) return JSON.parse(process.env.KHO_GOOGLE_SA_JSON);
  const file = process.env.KHO_GOOGLE_KEY_FILE?.replace(/^~(?=\/)/, os.homedir());
  if (!file) {
    console.error('沒有憑證：設 KHO_GOOGLE_KEY_FILE 指向服務帳號金鑰，或把 JSON 放進 KHO_GOOGLE_SA_JSON');
    process.exit(2);
  }
  return JSON.parse(await readFile(file, 'utf-8'));
}

async function accessToken(key) {
  const now = Math.floor(Date.now() / 1000);
  const claim = { iss: key.client_email, scope: SCOPES, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
  const body = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claim))}`;
  const sig = createSign('RSA-SHA256').update(body).end().sign(key.private_key).toString('base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${body}.${sig}` }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`換 access token 失敗：${res.status} ${JSON.stringify(json)}`);
  return json.access_token;
}

async function call(token, method, url) {
  const res = await fetch(url, { method, headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  return { ok: res.ok, status: res.status, json };
}

const gsc = (p) => `https://www.googleapis.com/webmasters/v3${p}`;
const enc = encodeURIComponent;

async function check(token, email) {
  console.log(`服務帳號：${email}\n`);

  const sites = await call(token, 'GET', gsc('/sites'));
  console.log('── Search Console 資源');
  if (!sites.ok) console.log(`  讀取失敗 ${sites.status}：${sites.json.error?.message}`);
  const entries = sites.json.siteEntry ?? [];
  if (sites.ok && !entries.length) console.log('  （空）服務帳號還沒被加進任何 Search Console 資源');
  for (const s of entries) console.log(`  ${s.siteUrl}　權限：${s.permissionLevel}`);

  if (entries.some((s) => s.siteUrl === PROPERTY)) {
    const maps = await call(token, 'GET', gsc(`/sites/${enc(PROPERTY)}/sitemaps`));
    console.log(`\n── ${PROPERTY} 已送出的 sitemap`);
    if (!maps.ok) console.log(`  讀取失敗 ${maps.status}：${maps.json.error?.message}`);
    const list = maps.json.sitemap ?? [];
    if (maps.ok && !list.length) console.log('  （尚未送出任何 sitemap）');
    for (const m of list) {
      const counts = (m.contents ?? []).map((c) => `${c.type} ${c.submitted} 送出`).join('、');
      console.log(`  ${m.path}　送出 ${m.lastSubmitted ?? '-'}　下載 ${m.lastDownloaded ?? '-'}　錯誤 ${m.errors ?? 0}　警告 ${m.warnings ?? 0}　${counts}`);
    }
  }

  const ga = await call(token, 'GET', 'https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200');
  console.log('\n── Google Analytics 帳戶／資源');
  if (!ga.ok) console.log(`  讀取失敗 ${ga.status}：${ga.json.error?.message}`);
  const accounts = ga.json.accountSummaries ?? [];
  if (ga.ok && !accounts.length) console.log('  （空）服務帳號還沒被加進任何 GA 帳戶');
  for (const a of accounts) {
    console.log(`  帳戶 ${a.displayName}（${a.account}）`);
    for (const p of a.propertySummaries ?? []) {
      console.log(`    資源 ${p.displayName}（${p.property}）`);
      // 評估 ID（G-…）掛在網站資料串流上，沒有串流就沒有 ID 可裝
      const streams = await call(token, 'GET', `https://analyticsadmin.googleapis.com/v1beta/${p.property}/dataStreams`);
      if (!streams.ok) { console.log(`      資料串流讀取失敗 ${streams.status}：${streams.json.error?.message}`); continue; }
      const list = streams.json.dataStreams ?? [];
      if (!list.length) console.log('      （沒有資料串流）');
      for (const s of list) {
        console.log(`      串流 ${s.displayName}　${s.type}　${s.webStreamData?.defaultUri ?? ''}　評估 ID ${s.webStreamData?.measurementId ?? '-'}`);
      }
    }
    if (!a.propertySummaries?.length) console.log('    （這個帳戶底下沒有資源）');
  }
}

async function submitSitemap(token) {
  const res = await call(token, 'PUT', gsc(`/sites/${enc(PROPERTY)}/sitemaps/${enc(SITEMAP)}`));
  if (!res.ok) {
    console.error(`送出失敗 ${res.status}：${res.json.error?.message}`);
    if (res.status === 403) console.error('403 多半是服務帳號在 Search Console 的權限不足：到「使用者和權限」把它設為擁有者');
    process.exit(1);
  }
  console.log(`已送出 ${SITEMAP} → ${PROPERTY}`);
}

const cmd = process.argv[2];
if (!['check', 'submit-sitemap'].includes(cmd)) {
  console.error('用法：node scripts/google.mjs check | submit-sitemap');
  process.exit(2);
}
const key = await loadKey();
const token = await accessToken(key);
if (cmd === 'check') await check(token, key.client_email);
else {
  await submitSitemap(token);
  await check(token, key.client_email);
}
