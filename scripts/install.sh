#!/usr/bin/env bash
# Praxis Installer — macOS / Linux
# v1.0.0.2
#
# 安装 Praxis 到 Claude Code:
#   1. 检测 bun 运行时
#   2. bun build 打包 (dist/)
#   3. 部署构建产物到 ~/.praxis/
#   4. 注册 Claude Code hooks
#   5. 注册 cron job (可选)
#
# 安装模式:
#   ./scripts/install.sh                     → 开发模式 (引用源码 dist/, 写当前项目 settings)
#   ./scripts/install.sh --target /path      → 项目级 (部署到 ~/.praxis/, 写目标项目 settings)
#   ./scripts/install.sh --global            → 全局 (部署到 ~/.praxis/, 写 ~/.claude/settings)
#
# 构建产物始终安装在 ~/.praxis (HOME 目录), 只装一份。
# --target 和 --global 的区别仅在于 hooks 写入哪个 settings.json。
#
# 用法:
#   ./scripts/install.sh [--target <dir>] [--global] [--skip-cron]
#                        [--agent-memory-url <url>] [--praxis-home <dir>] [--dry-run]

set -euo pipefail

TARGET=""
GLOBAL=false
PRAXIS_HOME=""
SKIP_CRON=false
AGENT_MEMORY_URL=""
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target) TARGET="$2"; shift 2 ;;
    --global) GLOBAL=true; shift ;;
    --praxis-home) PRAXIS_HOME="$2"; shift 2 ;;
    --skip-cron) SKIP_CRON=true; shift ;;
    --agent-memory-url) AGENT_MEMORY_URL="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ══════════════════════════════════════════════════════════════════
# 确定路径
# ══════════════════════════════════════════════════════════════════

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PRAXIS_HOME="${PRAXIS_HOME:-$(cd "$SCRIPT_DIR/.." && pwd)}"
BUN_PATH="$HOME/.bun/bin/bun"
PRAXIS_INSTALL_DIR="$HOME/.praxis"

# 确定安装模式和 settings.json 位置
if $GLOBAL; then
  INSTALL_MODE="global"
  SETTINGS_FILE="$HOME/.claude/settings.json"
elif [ -n "$TARGET" ]; then
  INSTALL_MODE="project"
  mkdir -p "$TARGET" 2>/dev/null || true
  TARGET="$(cd "$TARGET" 2>/dev/null && pwd || echo "$(pwd)/$TARGET")"
  SETTINGS_FILE="$TARGET/.claude/settings.json"
else
  INSTALL_MODE="dev"
  TARGET="$(pwd)"
  SETTINGS_FILE="$TARGET/.claude/settings.json"
fi

cat << EOF

  ╔═══════════════════════════════════════╗
  ║     Praxis v1.0.0.2 — Installer      ║
  ║  AI 认知操作系统 — Unix Edition       ║
  ╚═══════════════════════════════════════╝

  Mode:     $INSTALL_MODE
  Praxis:   $PRAXIS_HOME
  Target:   $TARGET
  Settings: $SETTINGS_FILE

EOF

# ══════════════════════════════════════════════════════════════════
# Step 1: 检测 bun
# ══════════════════════════════════════════════════════════════════

echo "[1/5] 检测 bun 运行时..."

if ! command -v bun &>/dev/null; then
  echo "  bun 未安装。正在通过 curl 安装..."
  if [ "$DRY_RUN" = true ]; then
    echo "  [DRY RUN] curl -fsSL https://bun.sh/install | bash"
  else
    curl -fsSL https://bun.sh/install | bash
  fi
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
  if ! command -v bun &>/dev/null; then
    echo "  ERROR: bun 安装失败。请手动安装: https://bun.sh"
    exit 1
  fi
fi

echo "  bun: $(bun --version)"

# ══════════════════════════════════════════════════════════════════
# Step 2: 构建 dist 打包
# ══════════════════════════════════════════════════════════════════

echo "[2/5] 构建 Praxis 打包 (bun build)..."

if [ "$DRY_RUN" = false ]; then
  (cd "$PRAXIS_HOME" && bun run build) || {
    echo "  ERROR: bun build 失败。请检查 TypeScript 编译错误。"
    exit 1
  }
fi
echo "  构建完成 → dist/praxis-hook.js, dist/praxis-cron.js"

# ══════════════════════════════════════════════════════════════════
# Step 3: 部署到 ~/.praxis/ (构建产物始终在 HOME)
# ══════════════════════════════════════════════════════════════════

if [ "$INSTALL_MODE" = "dev" ]; then
  echo "[3/5] 跳过 (开发模式: 直接引用源码 dist/)"
  PRAXIS_DIST_DIR="$PRAXIS_HOME/dist"
else
  echo "[3/5] 部署到 $PRAXIS_INSTALL_DIR ..."

  if [ "$DRY_RUN" = false ]; then
    mkdir -p "$PRAXIS_INSTALL_DIR/dist"
    cp "$PRAXIS_HOME/dist/praxis-hook.js" "$PRAXIS_INSTALL_DIR/dist/"
    cp "$PRAXIS_HOME/dist/praxis-cron.js"  "$PRAXIS_INSTALL_DIR/dist/"
    cp "$PRAXIS_HOME/package.json" "$PRAXIS_INSTALL_DIR/"
    (cd "$PRAXIS_INSTALL_DIR" && bun install --production) 2>/dev/null || true
  fi

  PRAXIS_DIST_DIR="$PRAXIS_INSTALL_DIR/dist"
  echo "  已部署: $PRAXIS_INSTALL_DIR/dist/"
fi

# ══════════════════════════════════════════════════════════════════
# Step 4: 注册 Claude Code hooks
# ══════════════════════════════════════════════════════════════════

case "$INSTALL_MODE" in
  global) echo "[4/5] 注册 Claude Code hooks (全局: ~/.claude/settings.json)..." ;;
  dev)    echo "[4/5] 注册 Claude Code hooks (开发: $SETTINGS_FILE)..." ;;
  *)      echo "[4/5] 注册 Claude Code hooks (项目: $SETTINGS_FILE)..." ;;
esac

PRAXIS_HOOKS=$(jq -n \
  --arg bun "$BUN_PATH" \
  --arg dist "$PRAXIS_DIST_DIR" \
  '{
    SessionStart: [{
      matcher: "",
      hooks: [{
        type: "command",
        command: "\($bun) \($dist)/praxis-hook.js session_start \"$CLAUDE_SESSION_ID\" 2>/dev/null || true",
        shell: "bash"
      }]
    }],
    UserPromptSubmit: [{
      matcher: "",
      hooks: [{
        type: "command",
        command: "\($bun) \($dist)/praxis-hook.js message_received \"$CLAUDE_SESSION_ID\" 2>/dev/null || true",
        shell: "bash",
        timeout: 45
      }]
    }],
    Stop: [{
      matcher: "",
      hooks: [{
        type: "command",
        command: "\($bun) \($dist)/praxis-hook.js agent_end \"$CLAUDE_SESSION_ID\" 2>/dev/null || true",
        shell: "bash"
      }]
    }]
  }')

PRAXIS_PERMISSIONS='[
  "mcp__agentmemory__memory_audit",
  "mcp__agentmemory__memory_export",
  "mcp__agentmemory__memory_governance_delete",
  "mcp__agentmemory__memory_recall",
  "mcp__agentmemory__memory_save",
  "mcp__agentmemory__memory_sessions",
  "mcp__agentmemory__memory_smart_search",
  "PowerShell"
]'

if [ "$DRY_RUN" = true ]; then
  echo "  [DRY RUN] 将写入 $SETTINGS_FILE:"
  echo "$PRAXIS_HOOKS" | jq '.'
else
  if [ -f "$SETTINGS_FILE" ]; then
    TMP=$(mktemp)
    jq --argjson praxis_hooks "$PRAXIS_HOOKS" \
       --argjson praxis_perms "$PRAXIS_PERMISSIONS" \
       '
         .hooks = (.hooks // {}) |
         # UserPromptExpansion: 仅在 key 不存在时初始化为空数组
         .hooks.UserPromptExpansion = (.hooks.UserPromptExpansion // []) |
         # SessionStart/UserPromptSubmit/Stop: 追加 Praxis 条目 (不覆盖用户已有)
         .hooks.SessionStart = (
           (.hooks.SessionStart // []) as $e |
           if ($e | any(.. | strings | test("praxis-hook"))) then $e
           else $e + ($praxis_hooks.SessionStart // []) end
         ) |
         .hooks.UserPromptSubmit = (
           (.hooks.UserPromptSubmit // []) as $e |
           if ($e | any(.. | strings | test("praxis-hook"))) then $e
           else $e + ($praxis_hooks.UserPromptSubmit // []) end
         ) |
         .hooks.Stop = (
           (.hooks.Stop // []) as $e |
           if ($e | any(.. | strings | test("praxis-hook"))) then $e
           else $e + ($praxis_hooks.Stop // []) end
         ) |
         .permissions.allow = (((.permissions.allow // []) + $praxis_perms) | unique) |
         .permissions = (.permissions // {allow: [], deny: []})
       ' "$SETTINGS_FILE" > "$TMP" && mv "$TMP" "$SETTINGS_FILE"
  else
    mkdir -p "$(dirname "$SETTINGS_FILE")"
    jq -n \
      --argjson hooks "$PRAXIS_HOOKS" \
      --argjson perms "$PRAXIS_PERMISSIONS" \
      '{ hooks: $hooks, permissions: { allow: $perms } }' \
      > "$SETTINGS_FILE"
  fi

  echo "  hooks 已注册"
  echo "    SessionStart     → $PRAXIS_DIST_DIR/praxis-hook.js"
  echo "    UserPromptSubmit → $PRAXIS_DIST_DIR/praxis-hook.js"
  echo "    Stop             → $PRAXIS_DIST_DIR/praxis-hook.js"
fi

# ══════════════════════════════════════════════════════════════════
# Step 5: AgentMemory 配置 (强依赖 — 健康检查 + 引导安装)
# ══════════════════════════════════════════════════════════════════

echo "[5/5] AgentMemory 配置..."

DEFAULT_AM_URL="http://localhost:3111"
AM_RUNNING=false

# 确定 AgentMemory URL
if [ -n "$AGENT_MEMORY_URL" ]; then
  AM_URL="$AGENT_MEMORY_URL"
  echo "  使用指定 URL: $AM_URL"
elif [ -f "$SETTINGS_FILE" ] && jq -e '.mcpServers.agentmemory' "$SETTINGS_FILE" > /dev/null 2>&1; then
  AM_URL=$(jq -r '.mcpServers.agentmemory.url // "http://localhost:3111"' "$SETTINGS_FILE")
  echo "  已有 MCP 配置: $AM_URL"
else
  AM_URL="$DEFAULT_AM_URL"
fi

# 始终做健康检查 (配置存在 ≠ 服务活着)
echo "  健康检查 $AM_URL ..."
if curl -sf --max-time 5 "$AM_URL/agentmemory/livez" > /dev/null 2>&1; then
  echo "  AgentMemory 运行中 ✓"
  AM_RUNNING=true
else
  echo "  AgentMemory 无响应"
fi

# 如果服务未运行 — 诊断+引导
if [ "$AM_RUNNING" = false ]; then
  if ! command -v agentmemory &>/dev/null; then
    echo "  AgentMemory CLI 未安装。"
    echo "    安装: npm install -g @agentmemory/agentmemory"
  else
    echo "  AgentMemory CLI 已安装但服务未启动。"
  fi
  echo "    启动: agentmemory"
  echo "    或指定自定义 URL: ./scripts/install.sh --agent-memory-url <url>"
fi

# 写入/更新 MCP 配置
if [ -n "$AM_URL" ] && [ "$DRY_RUN" = false ]; then
  TMP=$(mktemp)
  jq --arg url "$AM_URL" \
    '.mcpServers.agentmemory = {"type": "url", "url": $url}' \
    "$SETTINGS_FILE" > "$TMP" && mv "$TMP" "$SETTINGS_FILE"
  echo "  MCP 配置已写入: $AM_URL"
fi

if [ "$AM_RUNNING" = false ]; then
  echo ""
  echo "  ═══════════════════════════════════════════════════"
  echo "  ⚠ AgentMemory 服务未运行 — Praxis 强依赖"
  echo "  ═══════════════════════════════════════════════════"
  echo ""
  echo "  请先启动 AgentMemory，再启动 Claude Code。"
  echo ""
fi

# ══════════════════════════════════════════════════════════════════
# cron 注册
# ══════════════════════════════════════════════════════════════════

if [ "$SKIP_CRON" = false ] && [ "$DRY_RUN" = false ]; then
  echo ""
  echo "  ⏰ 注册 cron tick (每 30 分钟)..."
  PRAXIS_CRON_CMD="*/30 * * * * $BUN_PATH $PRAXIS_DIST_DIR/praxis-cron.js cron-tick >> /tmp/praxis-cron.log 2>&1"

  if $GLOBAL; then
    CRON_MARKER="praxis-cron-global"
  else
    CRON_MARKER="praxis-cron-$(echo "$TARGET" | md5sum | cut -c1-8)"
  fi

  if crontab -l 2>/dev/null | grep -q "$CRON_MARKER"; then
    echo "  已存在 ($CRON_MARKER)，跳过"
  else
    (crontab -l 2>/dev/null; echo "$PRAXIS_CRON_CMD # $CRON_MARKER") | crontab -
    echo "  cron tick 已注册"
  fi
fi

# ══════════════════════════════════════════════════════════════════
# 完成
# ══════════════════════════════════════════════════════════════════

echo ""
echo "  Praxis 安装完成!"
echo ""

if [ "$INSTALL_MODE" = "global" ]; then
  echo "  安装类型: 全局 — 所有项目共用 ~/.praxis/"
elif [ "$INSTALL_MODE" = "dev" ]; then
  echo "  安装类型: 开发模式 — 引用源码 dist/"
else
  echo "  安装类型: 项目级 — hooks 仅在 $TARGET 生效"
fi
echo "  Praxis 目录: $PRAXIS_INSTALL_DIR"
echo "  构建产物:    $PRAXIS_DIST_DIR"

echo ""
if [ "$INSTALL_MODE" = "global" ]; then
  echo "  卸载: ./scripts/uninstall.sh --global"
elif [ "$INSTALL_MODE" = "dev" ]; then
  echo "  卸载: ./scripts/uninstall.sh --target $TARGET"
else
  echo "  卸载: $PRAXIS_HOME/scripts/uninstall.sh --target $TARGET"
fi

echo ""
echo "  下一步:"
echo "    1. 重启 Claude Code"
echo "    2. 首次 session_start 将自动初始化 Praxis 认知引擎"
echo ""
