#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="$ROOT_DIR/qq-bot.pid"
LOG_DIR="$ROOT_DIR/logs"
LOG_FILE="$LOG_DIR/server.log"

is_running() {
  [[ -f "$PID_FILE" ]] || return 1
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  [[ -n "$pid" ]] || return 1
  kill -0 "$pid" 2>/dev/null
}

start_bot() {
  if is_running; then
    echo "qq-bot is already running: $(cat "$PID_FILE")"
    return 0
  fi
  mkdir -p "$LOG_DIR"
  cd "$ROOT_DIR"
  nohup pnpm exec tsx lib/server/index.ts >/dev/null 2>&1 &
  echo "$!" > "$PID_FILE"
  echo "qq-bot started: $(cat "$PID_FILE")"
  echo "logs: $LOG_FILE"
}

stop_bot() {
  if ! is_running; then
    rm -f "$PID_FILE"
    echo "qq-bot is not running"
    return 0
  fi
  local pid
  pid="$(cat "$PID_FILE")"
  kill "$pid"
  for _ in {1..20}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$PID_FILE"
      echo "qq-bot stopped"
      return 0
    fi
    sleep 0.2
  done
  kill -9 "$pid" 2>/dev/null || true
  rm -f "$PID_FILE"
  echo "qq-bot force stopped"
}

status_bot() {
  if is_running; then
    echo "qq-bot is running: $(cat "$PID_FILE")"
  else
    echo "qq-bot is not running"
  fi
}

case "${1:-restart}" in
  start)
    start_bot
    ;;
  stop)
    stop_bot
    ;;
  restart)
    stop_bot
    start_bot
    ;;
  status)
    status_bot
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|status}" >&2
    exit 2
    ;;
esac
