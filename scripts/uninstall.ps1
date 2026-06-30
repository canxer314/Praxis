# Praxis Uninstaller — Windows (PowerShell)
# v1.0.0.1
#
# 从 Claude Code 移除 Praxis:
#   .\scripts\uninstall.ps1 -Target D:\project   → 从指定项目移除
#   .\scripts\uninstall.ps1 -Global              → 从全局移除
#   .\scripts\uninstall.ps1 -Global -Purge       → 全局移除 + 删除 ~/.praxis
#
# 用法:
#   .\scripts\uninstall.ps1 [-Target <dir>] [-Global] [-Purge] [-DryRun]

param(
  [string]$Target = "",    # 从指定项目移除
  [switch]$Global,         # 从全局移除
  [switch]$Purge,          # 同时删除 Praxis 安装目录和 local-cache
  [switch]$DryRun          # 仅预览, 不写入
)

$ErrorActionPreference = "Stop"

# ══════════════════════════════════════════════════════════════════
# 确定 settings.json 路径
# ══════════════════════════════════════════════════════════════════

if ($Global) {
  $Mode = "全局"
  $SettingsFile = "$env:USERPROFILE\.claude\settings.json"
  $PraxisInstallDir = "$env:USERPROFILE\.praxis"
} else {
  $Mode = "项目级"
  if ($Target) {
    $TargetDir = (Resolve-Path $Target -ErrorAction SilentlyContinue).Path
    if (-not $TargetDir) {
      Write-Host "  目标目录不存在: $Target" -ForegroundColor Yellow
      exit 1
    }
    $SettingsFile = Join-Path $TargetDir ".claude\settings.json"
  } else {
    $TargetDir = (Get-Location).Path
    $SettingsFile = Join-Path $TargetDir ".claude\settings.json"
  }
}

Write-Host @"

  ╔═══════════════════════════════════════╗
  ║     Praxis — Uninstaller             ║
  ║  AI 认知操作系统 — Windows Edition    ║
  ╚═══════════════════════════════════════╝

  Mode:     $Mode
  Settings: $SettingsFile

"@

if (-not (Test-Path $SettingsFile)) {
  Write-Host "  ⚠ $SettingsFile 不存在, 无需卸载。" -ForegroundColor Yellow
  exit 0
}

# ══════════════════════════════════════════════════════════════════
# Step 1: 移除 Praxis hooks
# ══════════════════════════════════════════════════════════════════

Write-Host "[1/3] 移除 Praxis hooks..."

try {
  $settings = Get-Content $SettingsFile -Raw | ConvertFrom-Json -AsHashtable
} catch {
  Write-Host "  settings.json 格式错误, 中止。" -ForegroundColor Red
  exit 1
}

# 从 hook 数组中移除包含 praxis-hook 的条目 (兼容 .ts 和 .js)
# UserPromptExpansion 单独处理: 仅当为空数组时删除
$praxisHookTypes = @("SessionStart", "UserPromptSubmit", "Stop")

if ($settings.ContainsKey("hooks")) {
  foreach ($hookType in $praxisHookTypes) {
    if ($settings.hooks.ContainsKey($hookType)) {
      $filtered = [System.Collections.ArrayList]::new()
      foreach ($entry in $settings.hooks[$hookType]) {
        $hasPraxisHook = $false
        if ($entry -is [hashtable] -and $entry.ContainsKey("hooks")) {
          foreach ($h in $entry.hooks) {
            if ($h -is [hashtable] -and $h.ContainsKey("command")) {
              if ($h.command -match "praxis-hook") {
                $hasPraxisHook = $true
                break
              }
            }
          }
        }
        if (-not $hasPraxisHook) {
          $filtered.Add($entry) | Out-Null
        }
      }
      if ($filtered.Count -gt 0) {
        $settings.hooks[$hookType] = @($filtered)
      } else {
        $settings.hooks.Remove($hookType)
      }
    }
  }
  # 如果 hooks 全空, 删除整个 hooks 对象
  if ($settings.hooks.Count -eq 0) {
    $settings.Remove("hooks")
  }

  # UserPromptExpansion: 仅当为空数组时删除 (Praxis 占位, 不碰用户内容)
  if ($settings.hooks.ContainsKey("UserPromptExpansion")) {
    if ($settings.hooks["UserPromptExpansion"].Count -eq 0) {
      $settings.hooks.Remove("UserPromptExpansion")
    }
  }
}

# ══════════════════════════════════════════════════════════════════
# Step 2: 移除 Praxis 权限
# ══════════════════════════════════════════════════════════════════

Write-Host "[2/3] 移除 Praxis 权限..."

$praxisPermPatterns = @(
  "memory_audit",
  "memory_export",
  "memory_governance_delete",
  "memory_recall",
  "memory_save",
  "memory_sessions",
  "memory_smart_search"
)

if ($settings.ContainsKey("permissions") -and $settings.permissions.ContainsKey("allow")) {
  $filteredPerms = [System.Collections.ArrayList]::new()
  foreach ($perm in $settings.permissions.allow) {
    $isPraxisPerm = $false
    foreach ($pattern in $praxisPermPatterns) {
      if ($perm -match $pattern) {
        $isPraxisPerm = $true
        break
      }
    }
    if (-not $isPraxisPerm) {
      $filteredPerms.Add($perm) | Out-Null
    }
  }
  if ($filteredPerms.Count -gt 0) {
    $settings.permissions.allow = @($filteredPerms)
  } else {
    $settings.permissions.Remove("allow")
  }
}

# 移除 AgentMemory MCP
if ($settings.ContainsKey("mcpServers") -and $settings.mcpServers.ContainsKey("agentmemory")) {
  $settings.mcpServers.Remove("agentmemory")
  if ($settings.mcpServers.Count -eq 0) {
    $settings.Remove("mcpServers")
  }
  Write-Host "  AgentMemory MCP 已移除" -ForegroundColor Green
}

if ($DryRun) {
  Write-Host "  [DRY RUN] 将写入 $SettingsFile :"
  Write-Host ($settings | ConvertTo-Json -Depth 5)
} else {
  $settings | ConvertTo-Json -Depth 5 | Set-Content $SettingsFile -Encoding UTF8
  Write-Host "  Praxis hooks 和权限已移除" -ForegroundColor Green
}

# 移除 .claude/commands/praxis.md
$commandsFile = Join-Path (Split-Path -Parent $SettingsFile) "commands\praxis.md"
if (Test-Path $commandsFile) {
  if (-not $DryRun) { Remove-Item $commandsFile -Force -ErrorAction SilentlyContinue }
  Write-Host "  /praxis 命令已移除" -ForegroundColor Green
}

# 清理空的 commands 目录
$commandsDir = Join-Path (Split-Path -Parent $SettingsFile) "commands"
if ((Test-Path $commandsDir) -and -not (Get-ChildItem $commandsDir -ErrorAction SilentlyContinue)) {
  if (-not $DryRun) { Remove-Item $commandsDir -Force -ErrorAction SilentlyContinue }
}

# ══════════════════════════════════════════════════════════════════
# Step 3: 移除 Windows Task Scheduler 任务
# ══════════════════════════════════════════════════════════════════

Write-Host "[3/3] 移除 cron (Task Scheduler)..."

$taskPattern = "PraxisCronTick*"
$tasks = Get-ScheduledTask -TaskName $taskPattern -ErrorAction SilentlyContinue
if ($tasks) {
  if (-not $DryRun) {
    foreach ($t in $tasks) {
      Unregister-ScheduledTask -TaskName $t.TaskName -Confirm:$false -ErrorAction SilentlyContinue
      Write-Host "  已移除 Scheduled Task: $($t.TaskName)" -ForegroundColor Green
    }
  } else {
    Write-Host "  [DRY RUN] 将移除 Scheduled Tasks: $($tasks.TaskName -join ', ')"
  }
} else {
  Write-Host "  无 Praxis Task Scheduler 任务, 跳过"
}

# ══════════════════════════════════════════════════════════════════
# 可选: 清除 Praxis 安装目录
# ══════════════════════════════════════════════════════════════════

if ($Purge -and $Global) {
  Write-Host ""
  if (Test-Path $PraxisInstallDir) {
    if (-not $DryRun) {
      Remove-Item -Recurse -Force $PraxisInstallDir
      Write-Host "  🗑 已删除 $PraxisInstallDir" -ForegroundColor Green
    } else {
      Write-Host "  [DRY RUN] 将删除 $PraxisInstallDir"
    }
  }
  # 同时清理 local-cache
  $cacheDir = "$env:USERPROFILE\.praxis-phase1a"
  if (Test-Path $cacheDir) {
    if (-not $DryRun) {
      Remove-Item -Recurse -Force $cacheDir
      Write-Host "  🗑 已删除 local-cache: $cacheDir" -ForegroundColor Green
    } else {
      Write-Host "  [DRY RUN] 将删除 local-cache: $cacheDir"
    }
  }
}

# ══════════════════════════════════════════════════════════════════
# 完成
# ══════════════════════════════════════════════════════════════════

Write-Host ""
Write-Host "  Praxis 卸载完成!" -ForegroundColor Green
Write-Host ""

if ($Global -and -not $Purge) {
  Write-Host "  ℹ Praxis 源码仍在 $PraxisInstallDir (未使用 -Purge)"
  Write-Host "    local-cache 仍在 `$env:USERPROFILE\.praxis-phase1a"
  Write-Host "    如需完全清除，请使用: -Purge"
}

Write-Host ""
Write-Host "  建议重启 Claude Code 以使变更生效。"
Write-Host ""
