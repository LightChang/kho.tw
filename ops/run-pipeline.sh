#!/bin/bash
# ops/run-pipeline.sh
# 由 launchd 每小時喚醒一次（見 ops/tw.kho.pipeline.plist）。
#
# 「排程在程式裡，不在觸發器裡」——本腳本不決定哪個來源該抓，那是 transform/scheduler.mjs
# 讀 data/schedule-state.json 自己算的（見 ingest/CONTRACT.md §3）。這裡只負責：
#   1. 確保同一時間只有一輪在跑
#   2. 依 scheduler 的退出碼決定要不要往下跑整條管線
#   3. 把過程寫進 log 並輪替
#
# scheduler 的退出碼語意：
#   0 = 有來源內容變動 → 往下跑 normalize…build
#   2 = 到期的來源都沒變（或沒有來源到期）→ 這輪就到此為止，不必重算、不必重 build
#   其他 = 錯誤 → 記錄後結束，不 build
#
# check-health.mjs 的退出碼：
#   0 = 通過（warn 不擋，例如換期時課程數掉一半是正常的）
#   1 = 有來源數量異常 → 停在 build 之前。寧可讓網站停在昨天的版本，也不要把壞掉的資料發出去。
set -uo pipefail

# 這四個可以用環境變數覆寫，唯一的用途是**測試**：要驗失敗路徑（鎖有沒有清、
# last-run.json 有沒有寫、連續失敗有沒有累加），只要指到別的目錄跑就好，
# 不必去改這支檔案。改檔案來測試曾經把含中文註解的行弄出壞位元組，
# 結果驗到的是壞掉的副本，不是這支腳本。
# 預設值由腳本自身位置推導（ops/ 的上一層就是專案根目錄），不寫死任何人的家目錄——
# 這份檔案會進公開版控。要指到別的地方仍可用 KHO_ROOT 覆寫。
ROOT="${KHO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
NODE="${KHO_NODE:-/usr/local/bin/node}"
LOG_DIR="${KHO_LOG_DIR:-$ROOT/data/logs}"
LOCK_DIR="${KHO_LOCK_DIR:-$ROOT/data/.pipeline.lock}"
LOG_KEEP_DAYS=14
LOCK_STALE_HOURS=6

mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/pipeline-$(date +%Y-%m-%d).log"

log() { printf '%s  %s\n' "$(date '+%H:%M:%S')" "$*" >> "$LOG"; }

# ── 鎖：用 mkdir 當原子操作（macOS 沒有 flock 指令）──────────────
# 抓一輪社大加運動中心可能跑十幾分鐘，每小時喚醒一次有機會重疊。
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  # 鎖還在，但可能是上次跑到一半被砍掉留下的殘骸
  if [ -n "$(find "$LOCK_DIR" -maxdepth 0 -mmin +$((LOCK_STALE_HOURS * 60)) 2>/dev/null)" ]; then
    log "發現超過 ${LOCK_STALE_HOURS} 小時的殘留鎖，清掉後繼續"
    rm -rf "$LOCK_DIR"
    mkdir "$LOCK_DIR" 2>/dev/null || { log "清鎖後仍搶不到，放棄這輪"; exit 0; }
  else
    log "上一輪還在跑，跳過這輪"
    exit 0
  fi
fi
# ── 收尾：寫結果、必要時通知、清鎖 ──────────────────────────
# 排程是無人值守的，失敗如果只寫進 log，就要有人主動去看才會發現——不會有人去看。
# 所以每輪結束都留下一份機器可讀的結果，連續失敗才跳系統通知。
# 為什麼是「連續」失敗才通知：來源站台三天兩頭 503（實測 ty.twcc、lsy.tycc 就是），
# 單次失敗下一輪多半自己好了，每次都跳通知只會讓人把通知關掉。
STATUS_FILE="$LOG_DIR/last-run.json"
FAIL_FILE="$LOG_DIR/consecutive-failures"
NOTIFY_AFTER=3
CURRENT_STAGE=""

finish() {
  local code=$?
  local fails=0
  if [ "$code" -ne 0 ]; then
    fails=$(( $(cat "$FAIL_FILE" 2>/dev/null || echo 0) + 1 ))
    echo "$fails" > "$FAIL_FILE"
    # 變數一律寫成 ${x}：$code 後面直接接全形逗號時，bash 在非 UTF-8 的 locale 下
    # 會把中文位元組當成變數名的一部分，變成「code？: unbound variable」。
    # launchd 跑成功路徑碰不到這幾行，所以這種錯只會在真的失敗那天才爆出來。
    log "這輪失敗（退出碼 ${code}，階段：${CURRENT_STAGE:-未開始}），連續第 ${fails} 次"
    if [ "$fails" -ge "$NOTIFY_AFTER" ]; then
      osascript -e "display notification \"連續 $fails 次失敗，最後卡在 ${CURRENT_STAGE:-未開始}\" with title \"kho.tw 排程\"" 2>/dev/null
    fi
  else
    rm -f "$FAIL_FILE"
  fi
  # stage 用「未開始」而不是空字串：失敗在 node 檢查那步時還沒進入任何階段，
  # 留空的話讀這份 JSON 的人分不出「還沒開始」和「忘了記錄」。
  printf '{"finishedAt":"%s","exitCode":%s,"stage":"%s","consecutiveFailures":%s}\n' \
    "$(date '+%Y-%m-%dT%H:%M:%S%z')" "${code}" "${CURRENT_STAGE:-未開始}" "${fails}" > "$STATUS_FILE"
  rm -rf "$LOCK_DIR"
}
trap finish EXIT

cd "$ROOT" || { log "找不到專案目錄 $ROOT"; exit 1; }

# /usr/local/bin/node 是 symlink，指向 ~/.nvm/versions/node/<版本>/bin/node。
# nvm 換版本或清掉舊版時這條連結就斷，而 launchd 無人值守執行，斷了只會靜默失敗。
# 寧可在這裡明確記一筆再結束，也不要每小時安靜地什麼都沒做。
if [ ! -x "$NODE" ]; then
  log "找不到可執行的 node：${NODE}（nvm 換過版本的話，改這支腳本開頭的 NODE 變數）"
  exit 1
fi

started=$(date +%s)
log "───── 這輪開始 ─────"

# ── 1. 抓取 ────────────────────────────────────────────────
"$NODE" transform/scheduler.mjs >> "$LOG" 2>&1
sched=$?
case $sched in
  0) log "scheduler：有來源變動，往下跑" ;;
  2) log "scheduler：沒有來源變動，這輪結束"; exit 0 ;;
  *) log "scheduler：失敗（退出碼 ${sched}），這輪結束"; exit 1 ;;
esac

# ── 2. 正規化與健康檢查 ────────────────────────────────────
run_step() {
  local name="$1"; shift
  local t0 t1 code
  CURRENT_STAGE="$name"   # 失敗時 finish() 要說得出卡在哪一步
  t0=$(date +%s)
  "$@" >> "$LOG" 2>&1
  code=$?
  t1=$(date +%s)
  log "${name}：退出碼 ${code}，耗時 $((t1 - t0))s"
  return $code
}

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
run_step "site" "$NODE" site/build.mjs || { log "site build 失敗，停止"; exit 1; }
# 這三支要和 package.json 的 validate 保持一致——新增檢查器時兩邊都要記得加，
# 否則排程跑的驗證會比手動 npm run validate 弱，而且不會有人發現。
run_step "validate-jsonld" "$NODE" site/validate-jsonld.mjs || log "JSON-LD 驗證有問題（網站已產出，請查 log）"
run_step "check-links"     "$NODE" site/check-links.mjs     || log "連結檢查有問題（網站已產出，請查 log）"
run_step "check-sitemap"   "$NODE" site/check-sitemap.mjs   || log "sitemap 驗證有問題（網站已產出，請查 log）"

log "───── 這輪完成，共 $(( $(date +%s) - started ))s ─────"

# ── 5. log 輪替 ────────────────────────────────────────────
# 磁碟已用九成以上，不留無限期的 log。
find "$LOG_DIR" -name 'pipeline-*.log' -mtime +$LOG_KEEP_DAYS -delete 2>/dev/null
