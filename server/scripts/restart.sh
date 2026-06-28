#!/usr/bin/env bash
set -euo pipefail

SERVER_DIR="/root/qq-bot/server"
ROOT_DIR="/root/qq-bot"
LOG_DIR="$ROOT_DIR/logs"
PID_FILE="$ROOT_DIR/qq-bot.pid"
LOG_FILE="$LOG_DIR/server.log"
HEALTH_URL="http://127.0.0.1:8001/"

mkdir -p "$LOG_DIR"

find_server_pids() {
  # 找 cwd 正好在 server 目录、且命令包含 index.js 的 node 进程，避免误杀别的 node 服务。
  for pid in $(pgrep -x node 2>/dev/null || true); do
    local cwd cmd
    cwd="$(readlink "/proc/$pid/cwd" 2>/dev/null || true)"
    cmd="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
    if [[ "$cwd" == "$SERVER_DIR" && "$cmd" == *"index.js"* ]]; then
      echo "$pid"
    fi
  done

  # Hermes 以前启动过 bash wrapper，也顺手清掉。
  for pid in $(pgrep -f "cd $SERVER_DIR && node index.js" 2>/dev/null || true); do
    if [[ "$pid" != "$$" ]]; then
      echo "$pid"
    fi
  done
}

stop_server() {
  local pids
  pids="$(find_server_pids | sort -u | tr '\n' ' ')"
  if [[ -z "${pids// }" ]]; then
    echo "[restart] 没有发现旧进程"
    rm -f "$PID_FILE"
    return 0
  fi

  echo "[restart] 停止旧进程: $pids"
  kill $pids 2>/dev/null || true

  for _ in {1..20}; do
    if [[ -z "$(find_server_pids | sort -u | tr '\n' ' ')" ]]; then
      rm -f "$PID_FILE"
      echo "[restart] 旧进程已停止"
      return 0
    fi
    sleep 0.2
  done

  pids="$(find_server_pids | sort -u | tr '\n' ' ')"
  if [[ -n "${pids// }" ]]; then
    echo "[restart] 普通停止失败，强制 kill: $pids"
    kill -9 $pids 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
}

start_server() {
  echo "[restart] 启动 Node.js QQ Bot..."
  cd "$SERVER_DIR"
  nohup node index.js >> "$LOG_FILE" 2>&1 &
  local pid=$!
  echo "$pid" > "$PID_FILE"
  echo "[restart] 新进程 PID: $pid"

  for i in {1..30}; do
    if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
      echo "[restart] 健康检查通过: $HEALTH_URL"
      return 0
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "[restart] 进程启动后退出，最近日志："
      tail -80 "$LOG_FILE" || true
      return 1
    fi
    sleep 0.5
  done

  echo "[restart] 健康检查超时，最近日志："
  tail -80 "$LOG_FILE" || true
  return 1
}

status_server() {
  local pids
  pids="$(find_server_pids | sort -u | tr '\n' ' ')"
  if [[ -z "${pids// }" ]]; then
    echo "[restart] 服务未运行"
    return 1
  fi
  echo "[restart] 服务运行中: $pids"
  curl -fsS -o /dev/null -w "[restart] HTTP %{http_code}\n" "$HEALTH_URL" || true
}

case "${1:-restart}" in
  start)
    if [[ -n "$(find_server_pids | sort -u | tr '\n' ' ')" ]]; then
      echo "[restart] 服务已在运行"
      status_server
    else
      start_server
    fi
    ;;
  stop)
    stop_server
    ;;
  status)
    status_server
    ;;
  restart)
    stop_server
    start_server
    ;;
  *)
    echo "用法: $0 {restart|start|stop|status}"
    exit 2
    ;;
esac
