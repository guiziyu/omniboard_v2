#!/usr/bin/env bash
# 部署(proposal §3):scripts/deploy.sh <ref> [--migrate]
# 从 GitHub 取指定 ref,在新目录里安装与构建,用新代码自检(PG 连通、schema 版本、应用角色的权限),
# 通过后整目录切换并重启服务,再确认 /api/health 报告的是新版本;新版本起不来就切回上一个。
# 两个阶段(Neo、正式机)用同一个脚本。机器前置条件(Node、PG 放行、Caddy、systemd 单元、linger)
# 由 owner 准备,见 README「部署」。
#
# 目录($OMNIBOARD_HOME,默认 ~/omniboard-app):
#   repo/                     GitHub 仓库的镜像
#   shared/.env               凭据与配置,每个版本链接到它(不进仓库)
#   releases/<时间>-<提交>/   每次部署一个目录
#   current -> releases/...   systemd 单元的工作目录
set -euo pipefail

usage() {
  echo "usage: $0 <ref> [--migrate]" >&2
  echo "  --migrate  switch only after running npm run migrate from the new release" >&2
  exit 2
}
[ $# -ge 1 ] || usage
REF=$1
shift
MIGRATE=0
for arg in "$@"; do
  case "$arg" in
    --migrate) MIGRATE=1 ;;
    *) usage ;;
  esac
done

HOME_DIR=${OMNIBOARD_HOME:-$HOME/omniboard-app}
REPO_URL=${OMNIBOARD_REPO:-https://github.com/guiziyu/omniboard_v2.git}
SERVICE=${OMNIBOARD_SERVICE:-omniboard}
KEEP=${OMNIBOARD_KEEP_RELEASES:-5}
HEALTH_TIMEOUT=${OMNIBOARD_HEALTH_TIMEOUT:-60}

log() { printf '[deploy] %s\n' "$*"; }
fail() {
  printf '[deploy] FAILED: %s\n' "$*" >&2
  exit 1
}
# 安装与构建的输出进日志,失败时打印末尾。
LOG="$HOME_DIR/deploy.log"
run() {
  local what=$1
  shift
  printf '\n==== %s: %s\n' "$(date -u +%FT%TZ)" "$*" >>"$LOG"
  if ! "$@" >>"$LOG" 2>&1; then
    tail -n 30 "$LOG" >&2
    fail "$what failed (full output in $LOG)."
  fi
}

# ---- 前置条件 ----
for tool in git node npm curl flock systemctl; do
  command -v "$tool" >/dev/null || fail "$tool is not on PATH."
done
node_major=$(node -p 'process.versions.node.split(".")[0]')
[ "$node_major" = 24 ] || fail "Node 24 is required (found $(node -v))."
[ -f "$HOME_DIR/shared/.env" ] || fail "$HOME_DIR/shared/.env is missing. Copy .env.example and fill it in."
systemctl --user cat "$SERVICE" >/dev/null 2>&1 ||
  fail "systemd user unit $SERVICE is not installed. See README (scripts/omniboard.service)."
exec 9>"$HOME_DIR/deploy.lock"
flock -n 9 || fail "Another deploy is running."
# 健康检查只读 .env 里的端口,不读其他配置。
PORT=$(sed -n 's/^PORT=\([0-9]\{1,5\}\)[[:space:]]*$/\1/p' "$HOME_DIR/shared/.env" | tail -n 1)
PORT=${PORT:-4318}

# ---- 取代码 ----
mkdir -p "$HOME_DIR/releases"
if [ ! -d "$HOME_DIR/repo" ]; then
  log "Cloning $REPO_URL"
  git clone --quiet --mirror "$REPO_URL" "$HOME_DIR/repo"
else
  git -C "$HOME_DIR/repo" remote set-url origin "$REPO_URL"
  git -C "$HOME_DIR/repo" fetch --quiet --prune origin
fi
SHA=$(git -C "$HOME_DIR/repo" rev-parse --verify --quiet "$REF^{commit}") ||
  fail "Unknown ref: $REF"
RELEASE="$HOME_DIR/releases/$(date -u +%Y%m%dT%H%M%SZ)-${SHA:0:12}"
log "Deploying $REF ($SHA) into $RELEASE"
mkdir "$RELEASE"
# 失败时删掉没切换过去的新目录;切换之后由回滚逻辑处理。
switched=0
cleanup() {
  if [ "$switched" = 0 ] && [ -d "$RELEASE" ]; then
    rm -rf "$RELEASE"
  fi
}
trap cleanup EXIT
git -C "$HOME_DIR/repo" archive "$SHA" | tar -x -C "$RELEASE"
echo "$SHA" >"$RELEASE/REVISION"
ln -s ../../shared/.env "$RELEASE/.env"

# ---- 安装与构建(类型检查 + 前端)----
cd "$RELEASE"
log "Installing dependencies"
run "npm ci" npm ci --no-audit --no-fund
log "Building"
run "Build" npm run build

# ---- 迁移(可选)与自检 ----
if [ "$MIGRATE" = 1 ]; then
  log "Running migrations"
  npm run --silent migrate || fail "Migration failed. Nothing was switched."
fi
log "Self-check"
npm run --silent selfcheck || fail "Self-check failed. Nothing was switched."

# ---- 切换并确认新版本已启动 ----
PREVIOUS=$(readlink "$HOME_DIR/current" 2>/dev/null || true)
switch_to() {
  ln -sfn "$1" "$HOME_DIR/current.next"
  mv -T "$HOME_DIR/current.next" "$HOME_DIR/current"
  systemctl --user restart "$SERVICE"
}
healthy() {
  local deadline=$((SECONDS + HEALTH_TIMEOUT)) body
  while [ $SECONDS -lt $deadline ]; do
    body=$(curl -fsS --max-time 3 "http://127.0.0.1:$PORT/api/health" 2>/dev/null || true)
    if [[ "$body" == *'"status":"ok"'* && "$body" == *"\"revision\":\"$1\""* ]]; then
      return 0
    fi
    sleep 2
  done
  return 1
}
switched=1
log "Switching to ${RELEASE##*/}"
switch_to "$RELEASE"
if healthy "$SHA"; then
  log "Running $SHA on port $PORT."
else
  journal="journalctl --user -u $SERVICE -n 50"
  if [ -z "$PREVIOUS" ]; then
    fail "The new release did not become healthy and there is no previous release. Check: $journal"
  fi
  if [ "$MIGRATE" = 1 ]; then
    # 迁移只前进;旧代码遇到新 schema 会拒绝启动,切回去也起不来。
    fail "The new release did not become healthy after migrating; not rolling back. Check: $journal"
  fi
  log "The new release did not become healthy. Rolling back to ${PREVIOUS##*/}."
  switch_to "$PREVIOUS"
  healthy "$(cat "$PREVIOUS/REVISION")" || fail "Rollback did not become healthy either. Check: $journal"
  fail "Rolled back to ${PREVIOUS##*/}. Check: $journal"
fi

# ---- 只保留最近几个版本 ----
cd "$HOME_DIR/releases"
current=$(basename "$(readlink "$HOME_DIR/current")")
previous=$(basename "${PREVIOUS:-none}")
ls -1 | sort -r | tail -n +$((KEEP + 1)) | while read -r old; do
  [ "$old" = "$current" ] || [ "$old" = "$previous" ] || rm -rf "$old"
done
