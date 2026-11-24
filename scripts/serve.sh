#!/usr/bin/env bash
# LAST STOP game server — supervised local runner.
# Binds to 127.0.0.1 only; the public path is Tailscale Funnel (wss over 443),
# so no router/firewall ports are opened. Restart-loop keeps it alive.
#
# Usage:  scripts/serve.sh start | stop | status
# Env:    LS_MAX_ROOMS (default 4) — hard cap on concurrent rooms
#         PORT (default 2567)
set -u
cd "$(dirname "$0")/.."

PORT="${PORT:-2567}"
PIDFILE="/tmp/last-stop-server.pid"
LOG="/tmp/last-stop-server.log"

start() {
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "[last-stop] already running (pid $(cat "$PIDFILE"))"
    return 0
  fi
  echo "[last-stop] starting on 127.0.0.1:$PORT (rooms cap: ${LS_MAX_ROOMS:-4})" >&2
  # NOTE: run via tsx, NOT the esbuild bundle — bundling breaks colyseus 0.18's
  # HTTP router registration (/matchmake 404s in dist/index.mjs).
  nohup setsid env HOST=127.0.0.1 PORT="$PORT" LS_MAX_ROOMS="${LS_MAX_ROOMS:-4}" bash -c '
    while true; do
      pnpm --filter @last-stop/server exec tsx src/index.ts
      code=$?
      echo "[last-stop] server exited ($code) — restarting in 3s" >&2
      sleep 3
    done
  ' >>"$LOG" 2>&1 &
  echo $! > "$PIDFILE"
  sleep 2.5
  status
}

stop() {
  if [ -f "$PIDFILE" ]; then
    pid="$(cat "$PIDFILE")"
    kill -TERM -- -"$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null
    rm -f "$PIDFILE"
    pkill -TERM -f "apps/server/src/index[.]ts" 2>/dev/null
    echo "[last-stop] stopped"
  else
    echo "[last-stop] not running"
  fi
}

status() {
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "[last-stop] supervisor up (pid $(cat "$PIDFILE"))"
    if ! curl -fsS --max-time 2 "http://127.0.0.1:$PORT/health"; then
      echo "[last-stop] health check failed; see $LOG" >&2
      return 1
    fi
    echo
  else
    echo "[last-stop] down"
    exit 1
  fi
}

case "${1:-status}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  *) echo "usage: $0 start|stop|status" >&2; exit 2 ;;
esac
