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
  'https://www.googleapis.com/auth/analytics.readonly',
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

// sitemap index 底下每個分檔的狀態，以及抽樣網址的索引狀況。
// GSC 網頁介面的「網頁索引狀況」在 API 這邊對應 URL Inspection：一次一個網址，
// 每天 2,000 次上限，所以只抽樣——每種頁型各一個，看的是「這一類頁面 Google 怎麼判」。
async function diagnose(token) {
  const children = await call(token, 'GET', gsc(`/sites/${enc(PROPERTY)}/sitemaps?sitemapIndex=${enc(SITEMAP)}`));
  console.log('── sitemap 分檔');
  if (!children.ok) console.log(`  讀取失敗 ${children.status}：${children.json.error?.message}`);
  for (const m of children.json.sitemap ?? []) {
    const web = (m.contents ?? []).find((c) => c.type === 'web');
    console.log(`  ${m.path.replace('https://kho.tw/', '')}　${web?.submitted ?? 0} 個網址　錯誤 ${m.errors ?? 0}　警告 ${m.warnings ?? 0}　下載 ${m.lastDownloaded ?? '尚未'}`);
  }

  const samples = process.argv.slice(3);
  const urls = samples.length ? samples : [
    'https://kho.tw/',
    'https://kho.tw/open.html',
    'https://kho.tw/topics.html',
    'https://kho.tw/map.html',
  ];
  console.log('\n── 網址索引狀況（URL Inspection）');
  for (const url of urls) {
    const res = await fetch('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inspectionUrl: url, siteUrl: PROPERTY, languageCode: 'zh-TW' }),
    });
    const json = await res.json();
    if (!res.ok) { console.log(`  ${url}\n    查詢失敗 ${res.status}：${json.error?.message}`); continue; }
    const r = json.inspectionResult ?? {};
    const i = r.indexStatusResult ?? {};
    console.log(`  ${url}`);
    console.log(`    判定 ${i.verdict ?? '-'}　收錄狀態 ${i.coverageState ?? '-'}`);
    console.log(`    robots ${i.robotsTxtState ?? '-'}　編目 ${i.indexingState ?? '-'}　抓取 ${i.pageFetchState ?? '-'}　上次抓取 ${i.lastCrawlTime ?? '尚未'}`);
    if (i.sitemap?.length) console.log(`    來自 sitemap：${i.sitemap.join('、')}`);
    // 兩個 canonical 不一致＝Google 認為這頁跟別頁重複，會把流量歸給它選的那一個
    if (i.userCanonical || i.googleCanonical) {
      const same = i.userCanonical === i.googleCanonical;
      console.log(`    canonical 我方 ${i.userCanonical ?? '-'}${same ? '　（Google 同意）' : `\n    canonical Google 選 ${i.googleCanonical ?? '-'}　⚠ 不一致`}`);
    }
    if (r.mobileUsabilityResult?.verdict) console.log(`    行動裝置可用性 ${r.mobileUsabilityResult.verdict}`);
    for (const issue of r.mobileUsabilityResult?.issues ?? []) console.log(`      ${issue.severity} ${issue.issueType} ${issue.message ?? ''}`);
    for (const rr of r.richResultsResult?.detectedItems ?? []) console.log(`    複合式結果 ${rr.richResultType}：${rr.items?.length ?? 0} 項`);
    for (const rr of r.richResultsResult?.detectedItems ?? []) {
      for (const item of rr.items ?? []) {
        for (const issue of item.issues ?? []) console.log(`      ${issue.severity} ${issue.issueMessage}`);
      }
    }
  }
}

async function post(token, url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, json: await res.json() };
}

// 最後 3 天的資料 Search Console 還在補，數字之後會變（seh.tw 的 gsc-pull 同一個理由）。
const dayStr = (offset) => new Date(Date.now() - offset * 86400e3).toISOString().slice(0, 10);

async function performance(token, days) {
  const range = { startDate: dayStr(days + 3), endDate: dayStr(3) };
  console.log(`── 搜尋成效 ${range.startDate} ~ ${range.endDate}（刻意不看最後 3 天，資料還在補）`);
  const url = `https://www.googleapis.com/webmasters/v3/sites/${enc(PROPERTY)}/searchAnalytics/query`;
  const total = await post(token, url, { ...range, dimensions: ['date'], rowLimit: 1000 });
  if (!total.ok) { console.log(`  查詢失敗 ${total.status}：${total.json.error?.message}`); return; }
  const rows = total.json.rows ?? [];
  if (!rows.length) console.log('  （這段期間沒有資料）');
  for (const r of rows) console.log(`  ${r.keys[0]}　曝光 ${r.impressions}　點擊 ${r.clicks}　平均排名 ${r.position.toFixed(1)}`);

  for (const dim of ['page', 'query']) {
    const res = await post(token, url, { ...range, dimensions: [dim], rowLimit: 10 });
    console.log(`\n  依${dim === 'page' ? '頁面' : '查詢字詞'}（前 10）`);
    const list = res.json.rows ?? [];
    if (!list.length) console.log('    （沒有資料）');
    for (const r of list) console.log(`    ${r.keys[0]}　曝光 ${r.impressions}　點擊 ${r.clicks}`);
  }
}

async function ga(token, days) {
  const summaries = await call(token, 'GET', 'https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200');
  const property = (summaries.json.accountSummaries ?? []).flatMap((a) => a.propertySummaries ?? [])
    .find((p) => p.displayName === 'kho.tw');
  if (!property) { console.log('找不到名為 kho.tw 的 GA 資源；服務帳號可能還沒被加進 GA 帳戶'); return; }
  const url = `https://analyticsdata.googleapis.com/v1beta/${property.property}:runReport`;
  const range = [{ startDate: `${days}daysAgo`, endDate: 'today' }];
  console.log(`── GA ${property.property} 最近 ${days} 天`);

  const byDate = await post(token, url, {
    dateRanges: range,
    dimensions: [{ name: 'date' }],
    metrics: [{ name: 'activeUsers' }, { name: 'sessions' }, { name: 'screenPageViews' }],
    orderBys: [{ dimension: { dimensionName: 'date' } }],
  });
  if (!byDate.ok) { console.log(`  查詢失敗 ${byDate.status}：${byDate.json.error?.message}`); return; }
  const rows = byDate.json.rows ?? [];
  if (!rows.length) console.log('  （這段期間沒有資料）');
  for (const r of rows) console.log(`  ${r.dimensionValues[0].value}　使用者 ${r.metricValues[0].value}　工作階段 ${r.metricValues[1].value}　瀏覽 ${r.metricValues[2].value}`);

  // 參照來源：生成式引擎有沒有導流過來，只能從這裡看（它們不提供「你被引用幾次」的 API）。
  // sessionSource 是 GA 判定的來源網域，chatgpt.com、perplexity.ai 這類會出現在這一欄。
  const bySource = await post(token, url, {
    dateRanges: range,
    dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' }],
    metrics: [{ name: 'sessions' }],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit: 20,
  });
  console.log('\n  參照來源（前 20）');
  if (!bySource.ok) { console.log(`    查詢失敗 ${bySource.status}：${bySource.json.error?.message}`); return; }
  const srcs = bySource.json.rows ?? [];
  if (!srcs.length) console.log('    （沒有資料）');
  for (const r of srcs) {
    console.log(`    ${r.dimensionValues[0].value} / ${r.dimensionValues[1].value}　工作階段 ${r.metricValues[0].value}`);
  }
}

const cmd = process.argv[2];
if (!['check', 'submit-sitemap', 'diagnose', 'performance', 'ga'].includes(cmd)) {
  console.error('用法：node scripts/google.mjs check | submit-sitemap | diagnose [網址...] | performance [天數] | ga [天數]');
  process.exit(2);
}
const key = await loadKey();
const token = await accessToken(key);
if (cmd === 'check') await check(token, key.client_email);
else if (cmd === 'diagnose') await diagnose(token);
else if (cmd === 'performance') await performance(token, Number(process.argv[3] ?? 28));
else if (cmd === 'ga') await ga(token, Number(process.argv[3] ?? 28));
else {
  await submitSitemap(token);
  await check(token, key.client_email);
}
