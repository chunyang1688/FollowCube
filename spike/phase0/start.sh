#!/usr/bin/env bash
# FollowCube phase0 本地预览
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-8765}"

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "端口 $PORT 已被占用，直接打开："
  echo "  http://127.0.0.1:$PORT/"
  exit 0
fi

echo "在 $(pwd) 启动静态服务 → http://127.0.0.1:$PORT/"
exec python3 -m http.server "$PORT"
