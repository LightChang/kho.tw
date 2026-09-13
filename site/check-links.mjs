// site/check-links.mjs
// 檢查 dist/ 裡所有站內連結都指到存在的檔案。
// 首頁四個門、頁首導覽、縣市／類型索引都是手寫路徑，打錯不會有任何錯誤訊息，
// 只會變成 404，所以要自動驗。
//
// 用法：node site/check-links.mjs [dist 目錄]
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const DIST = process.argv[2] ?? path.resolve(import.meta.dirname, '..', 'dist');

async function* htmlFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* htmlFiles(full);
    else if (entry.name.endsWith('.html')) yield full;
  }
}

const exists = async (p) => {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
};

async function main() {
  const missing = new Map(); // 目標 → 來源頁面集合
  let pages = 0;
  let links = 0;
  for await (const file of htmlFiles(DIST)) {
    pages += 1;
    // 先剝掉 <script>：前端搜尋是用字串拼 '<a href="/course/'+id+'.html">'，
    // 那不是連結，掃進來只會製造假警報。
    const html = (await readFile(file, 'utf-8')).replace(/<script[\s\S]*?<\/script>/gi, '');
    const from = path.relative(DIST, file);
    for (const m of html.matchAll(/href="([^"]+)"/g)) {
      const href = m[1];
      // 只驗站內絕對路徑；外部連結、錨點、mailto 不在範圍
      if (!href.startsWith('/')) continue;
      links += 1;
      const clean = decodeURIComponent(href.split('#')[0].split('?')[0]);
      const target = clean === '/' ? 'index.html' : clean.replace(/^\//, '');
      if (!(await exists(path.join(DIST, target)))) {
        if (!missing.has(target)) missing.set(target, new Set());
        missing.get(target).add(from);
      }
    }
  }
  process.stderr.write(`檢查 ${pages} 頁、${links} 個站內連結\n`);
  if (missing.size === 0) {
    process.stderr.write('沒有失效連結\n');
    return;
  }
  const rows = [...missing.entries()].sort((a, b) => b[1].size - a[1].size);
  process.stderr.write(`\n${rows.length} 個目標不存在：\n`);
  for (const [target, sources] of rows.slice(0, 20)) {
    const sample = [...sources].slice(0, 2).join('、');
    process.stderr.write(`  ${target}　← 被 ${sources.size} 頁引用（例：${sample}）\n`);
  }
  process.exitCode = 1;
}

await main();
