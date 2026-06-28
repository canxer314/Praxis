#!/usr/bin/env bash
# Praxis Installer — macOS / Linux
# v1.0.0.0
#
# 一键安装 Praxis 到 Claude Code:
#   1. 检测 bun 运行时
#   2. 配置 AgentMemory MCP 连接
#   3. 注册 Claude Code hooks (SessionStart / Stop / UserPromptSubmit)
#   4. 注册 cron job (可选)
#
# 用法: ./scripts/install.sh [--skip-cron] [--agent-memory-url <url>] [--dry-run]

set -euo pipefail

SKIP_CRON=false
AGENT_MEMORY_URL=""
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-cron) SKIP_CRON=true; shift ;;
    --agent-memory-url) AGENT_MEMORY_URL="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

cat << 'EOF'

  ╔═══════════════════════════════════════╗
  ║     Praxis v1.0.0.0 — Installer      ║
  ║  AI 认知操作系统 — Unix Edition       ║
  ╚═══════════════════════════════════════╝

EOF

# ══════════════════════════════════════════════════════════════════
# Step 1: 检测 bun
# ══════════════════════════════════════════════════════════════════

echo "[1/4] 检测 bun 运行时..."

if ! command -v bun &>/dev/null; then
  echo "  bun 未安装。正在通过 curl 安装..."
  if [ "$DRY_RUN" = true ]; then
    echo "  [DRY RUN] curl -fsSL https://bun.sh/install | bash"
  else
    curl -fsSL https://bun.sh/install | bash
  fi
  # Source the updated profile
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
  if ! command -v bun &>/dev/null; then
    echo "  ERROR: bun 安装失败。请手动安装: https://bun.sh"
    exit 1
  fi
fi

echo "  bun: $(bun --version)"

# ══════════════════════════════════════════════════════════════════
# Step 2: 安装 npm 依赖
# ══════════════════════════════════════════════════════════════════

echo "[2/4] 安装依赖..."

if [ "$DRY_RUN" = false ]; then
  bun install --production 2>/dev/null || true
fi
echo "  依赖就绪"

# ══════════════════════════════════════════════════════════════════
# Step 3: 配置 Claude Code hooks
# ══════════════════════════════════════════════════════════════════

echo "[3/4] 注册 Claude Code hooks..."

SETTINGS_FILE=".claude/settings.json"
BUN_PATH="$HOME/.bun/bin/bun"

# 构建 hook 配置
HOOKS_JSON=$(cat << ENDJSON
{
  "hooks": {
    "SessionStart": [{
      "matcher": "",
      "hooks": [{
        "type": "command",
        "command": "try { & \\\"$BUN_PATH\\\" scripts/praxis-hook.ts session_start \\\"\\$env:CLAUDE_SESSION_ID\\\" 2>\\$null } catch {} ; exit 0",
        "shell": "powershell"
      }]
    }],
    "UserPromptExpansion": [],
    "UserPromptSubmit": [{
      "matcher": "",
      "hooks": [{
        "type": "command",
        "command": "try { & \\\"$BUN_PATH\\\" scripts/praxis-hook.ts message_received \\\"\\$env:CLAUDE_SESSION_ID\\\" 2>\\$null } catch {} ; exit 0",
        "shell": "powershell",
        "timeout": 45
      }]
    }],
    "Stop": [{
      "matcher": "",
      "hooks": [{
        "type": "command",
        "command": "try { & \\\"$BUN_PATH\\\" scripts/praxis-hook.ts agent_end \\\"\\$env:CLAUDE_SESSION_ID\\\" 2>\\$null } catch {} ; exit 0",
        "shell": "powershell"
      }]
    }]
  }
}
ENDJSON
)

if [ "$DRY_RUN" = true ]; then
  echo "  [DRY RUN] 将写入 $SETTINGS_FILE:"
  echo "$HOOKS_JSON"
else
  echo "$HOOKS_JSON" > "$SETTINGS_FILE"
  echo "  hooks 已注册到 $SETTINGS_FILE"
  echo "    SessionStart     → scripts/praxis-hook.ts session_start"
  echo "    UserPromptSubmit → scripts/praxis-hook.ts message_received"
  echo "    Stop             → scripts/praxis-hook.ts agent_end"
fi

# ══════════════════════════════════════════════════════════════════
# Step 4: AgentMemory 配置 (可选)
# ══════════════════════════════════════════════════════════════════

echo "[4/4] AgentMemory 配置..."

if [ -n "$AGENT_MEMORY_URL" ]; then
  if [ "$DRY_RUN" = false ]; then
    # 使用临时文件合并 JSON (避免破坏现有配置)
    TMP=$(mktemp)
    jq --arg url "$AGENT_MEMORY_URL" \
      '.mcpServers.agentmemory = {"type": "url", "url": $url}' \
      "$SETTINGS_FILE" > "$TMP" && mv "$TMP" "$SETTINGS_FILE"
  fi
  echo "  AgentMemory MCP 已配置: $AGENT_MEMORY_URL"
else
  echo "  跳过 (未提供 --agent-memory-url)。Praxis 将以 local-cache 降级模式运行。"
fi

# ══════════════════════════════════════════════════════════════════
# 完成
# ══════════════════════════════════════════════════════════════════

echo ""
echo "  Praxis 安装完成!"
echo ""

if [ ! -f "$SETTINGS_FILE" ]; then
  echo "  ⚠ .claude/settings.json 未找到 — 请确保在 Praxis 项目根目录下运行此脚本"
elif [ -z "$AGENT_MEMORY_URL" ]; then
  echo "  ⚠ AgentMemory 未配置。Praxis 将以 local-cache 降级模式运行。"
fi

echo ""
echo "  下一步:"
echo "    1. 重启 Claude Code session"
echo "    2. 首次 session_start 将自动初始化 Praxis 认知引擎"
echo ""

# cron
if [ "$SKIP_CRON" = false ] && [ "$DRY_RUN" = false ]; then
  echo "  ⏰ 注册 cron tick (每 30 分钟)..."
  CRON_LINE="*/30 * * * * cd $(pwd) && $BUN_PATH scripts/praxis-cron.ts cron-tick >> /tmp/praxis-cron.log 2>&1"
  if crontab -l 2>/dev/null | grep -q "praxis-cron"; then
    echo "  已存在，跳过"
  else
    (crontab -l 2>/dev/null; echo "$CRON_LINE") | crontab -
    echo "  cron tick 已注册"
  fi
fi
