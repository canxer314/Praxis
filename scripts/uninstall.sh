#!/usr/bin/env bash
# Praxis Uninstaller — macOS / Linux
# v1.0.0.1
#
# 从 Claude Code 移除 Praxis:
#   ./scripts/uninstall.sh --target /path    → 从指定项目移除
#   ./scripts/uninstall.sh --global          → 从全局移除
#   ./scripts/uninstall.sh --global --purge  → 全局移除 + 删除 ~/.praxis
#
# 用法:
#   ./scripts/uninstall.sh [--target <dir>] [--global] [--purge] [--dry-run]

set -euo pipefail

TARGET=""
GLOBAL=false
PURGE=false
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target) TARGET="$2"; shift 2 ;;
    --global) GLOBAL=true; shift ;;
    --purge) PURGE=true; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ══════════════════════════════════════════════════════════════════
# 确定要操作的 settings.json
# ══════════════════════════════════════════════════════════════════

if $GLOBAL; then
  MODE="全局"
  SETTINGS_FILE="$HOME/.claude/settings.json"
  PRAXIS_INSTALL_DIR="$HOME/.praxis"
else
  MODE="项目级"
  if [ -n "$TARGET" ]; then
    SETTINGS_FILE="$TARGET/.claude/settings.json"
  else
    TARGET="$(pwd)"
    SETTINGS_FILE="$TARGET/.claude/settings.json"
  fi
fi

cat << EOF

  ╔═══════════════════════════════════════╗
  ║     Praxis — Uninstaller             ║
  ║  AI 认知操作系统 — Unix Edition       ║
  ╚═══════════════════════════════════════╝

  Mode:     $MODE
  Settings: $SETTINGS_FILE

EOF

if [ ! -f "$SETTINGS_FILE" ]; then
  echo "  ⚠ $SETTINGS_FILE 不存在，无需卸载。"
  exit 0
fi

# ══════════════════════════════════════════════════════════════════
# Step 1: 移除 Praxis hooks
# ══════════════════════════════════════════════════════════════════

echo "[1/3] 移除 Praxis hooks..."

# 用 jq 过滤掉 Praxis 的 hook 条目 (command 包含 praxis-hook 的, 兼容 .ts 和 .js)
PRAXIS_HOOK_TYPES="SessionStart UserPromptSubmit PreToolUse PostToolUse Stop SessionEnd"

remove_praxis_hooks_filter=""
for ht in $PRAXIS_HOOK_TYPES; do
  remove_praxis_hooks_filter="${remove_praxis_hooks_filter}
    .hooks.\"$ht\" = (.hooks.\"$ht\" // []) |
    .hooks.\"$ht\" = [
      .hooks.\"$ht\"[] |
      select(
        (.hooks // []) |
        all(.command | test(\"praxis-hook\") | not)
      )
    ] |
    if (.hooks.\"$ht\" | length) == 0 then del(.hooks.\"$ht\") else . end |"
done

# 移除 Praxis 权限
PRAXIS_PERMS_PATTERN='memory_audit|memory_export|memory_governance_delete|memory_recall|memory_save|memory_sessions|memory_smart_search'

CLEANUP_FILTER='
  # UserPromptExpansion: 仅当为空数组时删除 (避免误删用户 hooks)
  if (.hooks.UserPromptExpansion == []) then del(.hooks.UserPromptExpansion) else . end |
  # 移除 Praxis 管理的 hook 类型中的 Praxis 条目
'"$remove_praxis_hooks_filter"'
  # 移除 Praxis 权限
  .permissions.allow = ((.permissions.allow // []) | map(select(test("'"$PRAXIS_PERMS_PATTERN"'") | not))) |
  # 如果 hooks 对象全空, 删除整个 hooks
  if (.hooks | length) == 0 then del(.hooks) else . end |
  # 如果 permissions.allow 为空, 删除之
  if ((.permissions.allow // []) | length) == 0 then del(.permissions.allow) else . end
'

if [ "$DRY_RUN" = true ]; then
  echo "  [DRY RUN] 将从 $SETTINGS_FILE 移除 Praxis 条目:"
  jq "$CLEANUP_FILTER" "$SETTINGS_FILE"
else
  TMP=$(mktemp)
  jq "$CLEANUP_FILTER" "$SETTINGS_FILE" > "$TMP" && mv "$TMP" "$SETTINGS_FILE"
  echo "  Praxis hooks 已移除"
fi

# 移除 .claude/commands/praxis.md
COMMANDS_FILE="$(dirname "$SETTINGS_FILE")/commands/praxis.md"
if [ -f "$COMMANDS_FILE" ]; then
  if [ "$DRY_RUN" = false ]; then rm -f "$COMMANDS_FILE"; fi
  echo "  /praxis 命令已移除"
  # 清理空的 commands 目录
  COMMANDS_DIR="$(dirname "$COMMANDS_FILE")"
  if [ -d "$COMMANDS_DIR" ] && [ -z "$(ls -A "$COMMANDS_DIR" 2>/dev/null)" ]; then
    if [ "$DRY_RUN" = false ]; then rmdir "$COMMANDS_DIR" 2>/dev/null || true; fi
  fi
fi

# ══════════════════════════════════════════════════════════════════
# Step 2: 移除 AgentMemory MCP (如果存在)
# ══════════════════════════════════════════════════════════════════

echo "[2/3] 移除 AgentMemory MCP 配置..."

if [ "$DRY_RUN" = false ]; then
  if jq -e '.mcpServers.agentmemory' "$SETTINGS_FILE" > /dev/null 2>&1; then
    TMP=$(mktemp)
    jq 'del(.mcpServers.agentmemory)' "$SETTINGS_FILE" > "$TMP" && mv "$TMP" "$SETTINGS_FILE"
    # 清理空的 mcpServers
    TMP2=$(mktemp)
    jq 'if (.mcpServers | length) == 0 then del(.mcpServers) else . end' "$SETTINGS_FILE" > "$TMP2" && mv "$TMP2" "$SETTINGS_FILE"
    echo "  AgentMemory MCP 已移除"
  else
    echo "  无 AgentMemory 配置，跳过"
  fi
fi

# ══════════════════════════════════════════════════════════════════
# Step 3: 移除 cron
# ══════════════════════════════════════════════════════════════════

echo "[3/3] 移除 cron..."

if [ "$DRY_RUN" = false ]; then
  if crontab -l 2>/dev/null | grep -q "praxis-cron"; then
    crontab -l 2>/dev/null | grep -v "praxis-cron" | crontab -
    echo "  Praxis cron 已移除"
  else
    echo "  无 Praxis cron，跳过"
  fi
fi

# ══════════════════════════════════════════════════════════════════
# 可选: 清除 Praxis 安装目录
# ══════════════════════════════════════════════════════════════════

if $PURGE && $GLOBAL; then
  echo ""
  if [ -d "$PRAXIS_INSTALL_DIR" ]; then
    if [ "$DRY_RUN" = false ]; then
      rm -rf "$PRAXIS_INSTALL_DIR"
      echo "  🗑 已删除 $PRAXIS_INSTALL_DIR"
    else
      echo "  [DRY RUN] 将删除 $PRAXIS_INSTALL_DIR"
    fi
  fi
  # 同时清理 local-cache
  CACHE_DIR="$HOME/.praxis-phase1a"
  if [ -d "$CACHE_DIR" ]; then
    if [ "$DRY_RUN" = false ]; then
      rm -rf "$CACHE_DIR"
      echo "  🗑 已删除 local-cache: $CACHE_DIR"
    else
      echo "  [DRY RUN] 将删除 local-cache: $CACHE_DIR"
    fi
  fi
fi

# ══════════════════════════════════════════════════════════════════
# 完成
# ══════════════════════════════════════════════════════════════════

echo ""
echo "  Praxis 卸载完成!"
echo ""

if $GLOBAL && ! $PURGE; then
  echo "  ℹ Praxis 源码仍在 $PRAXIS_INSTALL_DIR (未使用 --purge)"
  echo "    local-cache 仍在 $HOME/.praxis-phase1a"
  echo "    如需完全清除，请使用: --purge"
fi

echo ""
echo "  建议重启 Claude Code 以使变更生效。"
echo ""
