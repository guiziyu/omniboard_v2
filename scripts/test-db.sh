#!/usr/bin/env bash
# 私有测试 PG:本仓库 .pgdata 下的独立实例,只开 unix socket(不监听 TCP),不需要 sudo,
# 不碰机器上已有的 PG。用法:scripts/test-db.sh up|down|url
set -euo pipefail
cd "$(dirname "$0")/.."
BIN=${PG_BIN:-/usr/lib/postgresql/16/bin}
DATA=$PWD/.pgdata/data
SOCK=$PWD/.pgdata/socket
PORT=55432
url() { echo "postgresql://postgres@localhost/postgres?host=$SOCK&port=$PORT"; }
case "${1:-}" in
  up)
    mkdir -p "$SOCK"
    if [ ! -f "$DATA/PG_VERSION" ]; then
      "$BIN/initdb" -D "$DATA" -U postgres --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null
    fi
    if ! "$BIN/pg_ctl" -D "$DATA" status >/dev/null 2>&1; then
      "$BIN/pg_ctl" -D "$DATA" -l "$PWD/.pgdata/log" -w start \
        -o "-c listen_addresses='' -c unix_socket_directories='$SOCK' -p $PORT -c shared_buffers=64MB -c fsync=off" >/dev/null
    fi
    url ;;
  down) "$BIN/pg_ctl" -D "$DATA" -w stop >/dev/null && echo stopped ;;
  url) url ;;
  *) echo "usage: $0 up|down|url" >&2; exit 2 ;;
esac
