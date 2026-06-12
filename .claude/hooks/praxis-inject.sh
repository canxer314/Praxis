#!/bin/bash
# Praxis PoC SessionStart hook — 将上下文注入 system prompt
# 此脚本的 stdout 会被 Claude Code 自动注入到 session 的 system prompt
set -e

PROJ_DIR="$CLAUDE_PROJECT_DIR"
if [ -z "$PROJ_DIR" ]; then
  PROJ_DIR=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
fi

cd "$PROJ_DIR"

# 首次自动初始化
mkdir -p ~/.praxis-poc

if ! command -v node >/dev/null 2>&1; then
  echo "(Praxis PoC: Node.js 未安装，跳过上下文注入)"
  exit 0
fi

if [ ! -d "$PROJ_DIR/node_modules" ]; then
  echo "(Praxis PoC: 依赖未安装，运行 npm install 后生效)"
  exit 0
fi

# 静默运行 inject，错误时不阻塞 session 启动
npx tsx poc/index.ts inject 2>/dev/null || echo "(Praxis PoC: inject 失败，检查 npx tsx 是否可用)"
