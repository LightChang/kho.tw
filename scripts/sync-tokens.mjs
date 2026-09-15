// 從統一設計系統同步 token 檔。改 token 請改上游，不要改 src/styles/tokens.css。
//
// 上游預設在本 repo 的兄弟目錄（agent.system-integration-quality-control/），
// 位置不同時用 KHO_TOKENS_SRC 指定。不寫死絕對路徑：這份檔案進公開版控。
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = process.env.KHO_TOKENS_SRC
  ?? path.resolve(ROOT, '..', 'agent.system-integration-quality-control', 'templates', 'styles.css');
const DEST = path.join(ROOT, 'src', 'styles', 'tokens.css');
const HEADER = `/* ============================================================
 * 本檔為統一設計系統的副本，請勿直接編輯。
 *
 * 來源：agent.system-integration-quality-control/templates/styles.css
 * 同步：pnpm run sync:tokens
 *
 * 需要新增樣式時寫在 src/styles/site.css，不要改這裡；
 * 需要調整 token 值時改上游來源檔再同步回來。
 * ============================================================ */

`;

const css = await readFile(SRC, 'utf-8');
await writeFile(DEST, HEADER + css, 'utf-8');
process.stderr.write(`tokens 已同步：${css.length} bytes\n`);
