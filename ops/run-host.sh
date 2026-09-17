#!/bin/bash
# ops/run-host.sh
# 每小時排程的本機版本，2026-09-17 起取代 GitHub Actions 的 .github/workflows/deploy.yml。
#
# 為什麼從 GitHub Actions 搬回主機：站主決定排程在自己的機器上跑。
# 行為要跟原本的 workflow 一致，差別只有三個：
#   1. 抓取與建置在本機，不在 runner 上。
#   2. 部署改推 gh-pages 分支（GitHub Pages 的來源已從 workflow 改成該分支），
#      因為 actions/deploy-pages 只能在 Actions 裡用。dist 內有 _astro/，
#      分支來源會走 Jekyll，底線開頭的目錄會被吃掉——所以 public/.nojekyll 必須存在。
#   3. 與 seo-ops 的反思／大腦層共用同一把鎖 /tmp/seo-claude-kho.tw.lock。
#      那兩層也會改這個工作樹，一秒重疊就會 git 撞（seo-ops MAINTENANCE.md「新站/新產線檢查點」）。
#
# 與 ops/run-pipeline.sh 的關係：那支是 macOS launchd 版，只跑到建置為止，不 commit、不部署。
# 這支是 Linux 主機版，多了 git 同步、回寫、部署。兩支不會同時存在於同一台機器上。
#
# scheduler 退出碼：0=有來源變動、2=沒有來源到期或都沒變、其他=錯誤。
set -uo pipefail

ROOT="${KHO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
NODE="${KHO_NODE:-/usr/bin/node}"
LOG_DIR="${KHO_LOG_DIR:-$ROOT/data/logs}"
LOCK_FILE="${KHO_LOCK_FILE:-/tmp/seo-claude-kho.tw.lock}"
PAGES_WORKTREE="${KHO_PAGES_WORKTREE:-/root/.cache/kho-tw-gh-pages}"
BRANCH_PAGES=gh-pages
LOG_KEEP_DAYS=14
# GA 評估 ID 原本是 GitHub repository variable，本機沒有那個來源，所以放這裡。
# 這個值本來就印在每一頁的 HTML 裡，不是秘密。沒設就完全不輸出任何 Google 腳本。
export KHO_SITE_URL="${KHO_SITE_URL:-https://kho.tw}"
export KHO_GA_ID="${KHO_GA_ID:-G-TK4G7BS0QF}"

mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/pipeline-$(date +%Y-%m-%d).log"
log() { printf '%s  %s\n' "$(date '+%H:%M:%S')" "$*" >> "$LOG"; }

# ── 鎖：與 seo-reflect / seo-brain 同一把 ──────────────────────
# -n（不等待）而不是等：這支每小時都會再來一次，等在這裡只會讓下一輪疊上來。
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
  log "反思／大腦或上一輪還在跑，跳過這輪"
  exit 0
fi

STATUS_FILE="$LOG_DIR/last-run.json"
FAIL_FILE="$LOG_DIR/consecutive-failures"
CURRENT_STAGE=""

finish() {
  local code=$?
  local fails=0
  if [ "$code" -ne 0 ]; then
    fails=$(( $(cat "$FAIL_FILE" 2>/dev/null || echo 0) + 1 ))
    echo "$fails" > "$FAIL_FILE"
    log "這輪失敗（退出碼 ${code}，階段：${CURRENT_STAGE:-未開始}），連續第 ${fails} 次"
  else
    rm -f "$FAIL_FILE"
  fi
  printf '{"finishedAt":"%s","exitCode":%s,"stage":"%s","consecutiveFailures":%s}\n' \
    "$(date '+%Y-%m-%dT%H:%M:%S%z')" "${code}" "${CURRENT_STAGE:-未開始}" "${fails}" > "$STATUS_FILE"
}
trap finish EXIT

cd "$ROOT" || { log "找不到專案目錄 $ROOT"; exit 1; }
[ -x "$NODE" ] || { log "找不到可執行的 node：${NODE}"; exit 1; }

started=$(date +%s)
log "───── 這輪開始 ─────"

run_step() {
  local name="$1"; shift
  local t0 t1 code
  CURRENT_STAGE="$name"
  t0=$(date +%s)
  "$@" >> "$LOG" 2>&1
  code=$?
  t1=$(date +%s)
  log "${name}：退出碼 ${code}，耗時 $((t1 - t0))s"
  return $code
}

# ── 0. 先跟遠端對齊 ────────────────────────────────────────
# 反思／大腦層也會 push 這個 repo，本機落後時 commit 完會推不上去。
CURRENT_STAGE="sync"
git pull --rebase --autostash origin main >> "$LOG" 2>&1 || {
  log "git pull --rebase 失敗（可能有衝突），中止這輪，不動資料"
  git rebase --abort >> "$LOG" 2>&1
  exit 1
}

# ── 1. 抓取 ────────────────────────────────────────────────
CURRENT_STAGE="scheduler"
"$NODE" transform/scheduler.mjs >> "$LOG" 2>&1
sched=$?
case $sched in
  0) log "scheduler：有來源變動，往下跑" ;;
  2) log "scheduler：沒有來源變動，這輪結束（不重算、不重建、不部署）"; exit 0 ;;
  *) log "scheduler：失敗（退出碼 ${sched}），這輪結束"; exit 1 ;;
esac

# ── 2. 正規化與健康檢查 ────────────────────────────────────
run_step "normalize" "$NODE" transform/normalize.mjs || { log "normalize 失敗，停止"; exit 1; }
if ! run_step "health" "$NODE" transform/check-health.mjs; then
  log "健康檢查沒過，停在 build 之前（網站維持上一版）"
  exit 1
fi

# ── 3. 分群、關聯、投影 ────────────────────────────────────
run_step "cluster"   "$NODE" transform/cluster.mjs           || { log "cluster 失敗，停止"; exit 1; }
run_step "relations" "$NODE" transform/resolve-relations.mjs || { log "relations 失敗，停止"; exit 1; }
run_step "emit"      "$NODE" transform/emit.mjs              || { log "emit 失敗，停止"; exit 1; }

# ── 4. 產生網站並驗證 ──────────────────────────────────────
ASTRO="$ROOT/node_modules/astro/bin/astro.mjs"
if [ ! -f "$ASTRO" ]; then
  CURRENT_STAGE="site"
  log "找不到 ${ASTRO}，請先在專案目錄跑 pnpm install"
  exit 1
fi
run_step "site" "$NODE" "$ASTRO" build || { log "site build 失敗，停止（不部署）"; exit 1; }
# 驗證不過就不部署：原本的 workflow 是驗證失敗整個 job 紅字、deploy 步驟不會執行，
# 這裡要維持同樣的語意，不能「產出了就推上去」。
run_step "validate-jsonld" "$NODE" site/validate-jsonld.mjs || { log "JSON-LD 驗證沒過，不部署"; exit 1; }
run_step "check-links"     "$NODE" site/check-links.mjs     || { log "連結檢查沒過，不部署"; exit 1; }
run_step "check-sitemap"   "$NODE" site/check-sitemap.mjs   || { log "sitemap 驗證沒過，不部署"; exit 1; }

# ── 5. 回寫觀測軌跡 ────────────────────────────────────────
# 不回寫的話，下一輪會把每支來源都當成首次記錄，自適應排程與健康檢查的歷史全部歸零。
CURRENT_STAGE="commit"
git config user.name  'kho-ingest'
git config user.email 'ingest@kho.tw'
git add data/ geocode/out/ >> "$LOG" 2>&1
if ! git diff --cached --quiet; then
  git commit -q -m "ingest: $(date -u +%Y-%m-%dT%H:%MZ)" >> "$LOG" 2>&1
  git pull --rebase --autostash origin main >> "$LOG" 2>&1 || {
    log "回寫前 rebase 失敗，放棄推送（資料留在本機，下一輪再試）"
    git rebase --abort >> "$LOG" 2>&1
    exit 1
  }
  git push origin main >> "$LOG" 2>&1 || { log "push main 失敗"; exit 1; }
  log "commit：觀測軌跡已推上 main"
else
  log "commit：data/ 沒有變動"
fi

# ── 6. 部署：把 dist 推上 gh-pages ─────────────────────────
# 用獨立 worktree，不動主工作樹的分支狀態（反思／大腦隨時可能在看這個目錄）。
CURRENT_STAGE="deploy"
[ -f "$ROOT/dist/.nojekyll" ] || { log "dist 少了 .nojekyll，_astro/ 會被 Pages 吃掉，不部署"; exit 1; }
if [ ! -d "$PAGES_WORKTREE/.git" ] && ! git -C "$ROOT" worktree list | grep -q "$PAGES_WORKTREE"; then
  mkdir -p "$(dirname "$PAGES_WORKTREE")"
  if git ls-remote --exit-code --heads origin "$BRANCH_PAGES" >/dev/null 2>&1; then
    git fetch origin "$BRANCH_PAGES" >> "$LOG" 2>&1
    git worktree add "$PAGES_WORKTREE" "$BRANCH_PAGES" >> "$LOG" 2>&1 || { log "建立 gh-pages worktree 失敗"; exit 1; }
  else
    git worktree add --detach "$PAGES_WORKTREE" >> "$LOG" 2>&1 || { log "建立 worktree 失敗"; exit 1; }
    git -C "$PAGES_WORKTREE" checkout --orphan "$BRANCH_PAGES" >> "$LOG" 2>&1
    git -C "$PAGES_WORKTREE" rm -rq --cached . 2>/dev/null
  fi
fi
git -C "$PAGES_WORKTREE" fetch origin "$BRANCH_PAGES" >> "$LOG" 2>&1 || true
git -C "$PAGES_WORKTREE" reset -q --hard "origin/$BRANCH_PAGES" >> "$LOG" 2>&1 || true
# --delete：上一版有、這一版沒有的頁面要真的消失，否則舊網址會永遠留在線上。
# 排除 .git：worktree 的 .git 是一個檔案，被蓋掉就不是 git 目錄了。
rsync -a --delete --exclude '.git' "$ROOT/dist/" "$PAGES_WORKTREE/" >> "$LOG" 2>&1 || { log "rsync dist 失敗"; exit 1; }
git -C "$PAGES_WORKTREE" add -A >> "$LOG" 2>&1
if git -C "$PAGES_WORKTREE" diff --cached --quiet; then
  log "deploy：網站產出與線上版相同，不推"
else
  git -C "$PAGES_WORKTREE" -c user.name='kho-ingest' -c user.email='ingest@kho.tw' \
    commit -q -m "deploy: $(date -u +%Y-%m-%dT%H:%MZ)" >> "$LOG" 2>&1
  git -C "$PAGES_WORKTREE" push origin "$BRANCH_PAGES" >> "$LOG" 2>&1 || { log "push gh-pages 失敗"; exit 1; }
  log "deploy：已推上 $BRANCH_PAGES"
fi

log "───── 這輪完成，共 $(( $(date +%s) - started ))s ─────"
find "$LOG_DIR" -name 'pipeline-*.log' -mtime +$LOG_KEEP_DAYS -delete 2>/dev/null
