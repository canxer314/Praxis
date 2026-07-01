# Praxis Installer — Windows (PowerShell)
# v1.0.0.2
#
# 安装 Praxis 到 Claude Code:
#   1. 检测 bun 运行时
#   2. bun build 打包 (dist/)
#   3. 部署构建产物到 ~/.praxis/
#   4. 注册 Claude Code hooks
#   5. 注册 Windows Task Scheduler cron-tick (可选)
#
# 安装模式:
#   .\scripts\install.ps1                      → 开发模式 (引用源码 dist/, 写当前项目 settings)
#   .\scripts\install.ps1 -Target D:\project   → 项目级 (部署到 ~\.praxis\, 写目标项目 settings)
#   .\scripts\install.ps1 -Global              → 全局 (部署到 ~\.praxis\, 写 ~\.claude\settings)
#
# 构建产物始终安装在 ~\.praxis\ (HOME 目录), 只装一份。
# --target 和 --global 的区别仅在于 hooks 写入哪个 settings.json。
#
# 用法:
#   .\scripts\install.ps1 [-Target <dir>] [-Global] [-SkipCron]
#                         [-AgentMemoryUrl <url>] [-PraxisHome <dir>] [-DryRun]

param(
  [string]$Target = "",             # 安装到指定项目 (hooks 写入 Target/.claude/settings.json)
  [switch]$Global,                  # 全局安装 (hooks 写入 ~/.claude/settings.json)
  [string]$PraxisHome = "",         # Praxis 源码目录 (默认: 脚本所在目录的父目录)
  [switch]$SkipCron,                # 跳过 cron 注册
  [string]$AgentMemoryUrl = "",     # AgentMemory 网页 URL
  [switch]$DryRun                   # 仅预览, 不写入
)

$ErrorActionPreference = "Stop"

# ══════════════════════════════════════════════════════════════════
# 确定路径
# ══════════════════════════════════════════════════════════════════

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ScriptDir = (Resolve-Path $ScriptDir).Path

if ($PraxisHome) {
  $PraxisHome = (Resolve-Path $PraxisHome).Path
} else {
  $PraxisHome = Split-Path -Parent $ScriptDir
}

$bunPath = "$env:USERPROFILE\.bun\bin\bun.exe"
$PraxisInstallDir = "$env:USERPROFILE\.praxis"

# 确定 settings.json 位置 (只改变这个, 不改变安装目录)
if ($Global) {
  $InstallMode = "global"
  $SettingsFile = "$env:USERPROFILE\.claude\settings.json"
  $TargetDir = $env:USERPROFILE
} elseif ($Target) {
  $InstallMode = "project"
  if (-not (Test-Path $Target)) {
    New-Item -ItemType Directory -Force $Target | Out-Null
  }
  $TargetDir = (Resolve-Path $Target).Path
  $SettingsFile = Join-Path $TargetDir ".claude\settings.json"
} else {
  $InstallMode = "dev"
  $TargetDir = (Get-Location).Path
  $SettingsFile = Join-Path $TargetDir ".claude\settings.json"
}

Write-Host @"

  ╔═══════════════════════════════════════╗
  ║     Praxis v1.0.0.2 — Installer      ║
  ║  AI 认知操作系统 — Windows Edition     ║
  ╚═══════════════════════════════════════╝

  Mode:     $InstallMode
  Praxis:   $PraxisHome
  Target:   $TargetDir
  Settings: $SettingsFile

"@

# ══════════════════════════════════════════════════════════════════
# Step 1: 检测 bun
# ══════════════════════════════════════════════════════════════════

Write-Host "[1/5] 检测 bun 运行时..."

$bunInstalled = Test-Path $bunPath

if (-not $bunInstalled) {
  Write-Host "  bun 未安装。正在通过 PowerShell 安装..."
  if ($DryRun) {
    Write-Host "  [DRY RUN] irm bun.sh/install.ps1 | iex"
  } else {
    irm bun.sh/install.ps1 | iex
  }
  if (-not (Test-Path $bunPath)) {
    Write-Error "bun 安装失败。请手动安装: https://bun.sh"
    exit 1
  }
}
Write-Host "  bun: $(& $bunPath --version)" -ForegroundColor Green

# ══════════════════════════════════════════════════════════════════
# Step 2: 构建 dist 打包
# ══════════════════════════════════════════════════════════════════

Write-Host "[2/5] 构建 Praxis 打包 (bun build)..."

if (-not $DryRun) {
  Push-Location $PraxisHome
  try {
    & $bunPath run build
    if ($LASTEXITCODE -ne 0) {
      Write-Error "bun build 失败。请检查 TypeScript 编译错误。"
      exit 1
    }
  } finally {
    Pop-Location
  }
}
Write-Host "  构建完成 -> $PraxisHome\dist\praxis-hook.js, $PraxisHome\dist\praxis-cron.js" -ForegroundColor Green

# ══════════════════════════════════════════════════════════════════
# Step 3: 部署到 ~\.praxis\ (构建产物始终在 HOME)
# ══════════════════════════════════════════════════════════════════

if ($InstallMode -eq "dev") {
  Write-Host "[3/5] 跳过 (开发模式: 直接引用源码 dist/)"
  $PraxisDistDir = Join-Path $PraxisHome "dist"
} else {
  Write-Host "[3/5] 部署到 $PraxisInstallDir ..."

  if (-not $DryRun) {
    $distDest = Join-Path $PraxisInstallDir "dist"
    if (-not (Test-Path $distDest)) {
      New-Item -ItemType Directory -Force $distDest | Out-Null
    }
    Copy-Item "$PraxisHome\dist\praxis-hook.js" $distDest -Force
    Copy-Item "$PraxisHome\dist\praxis-cron.js"  $distDest -Force
    Copy-Item "$PraxisHome\package.json" $PraxisInstallDir -Force

    Push-Location $PraxisInstallDir
    try { & $bunPath install --production 2>$null } finally { Pop-Location }
  }

  $PraxisDistDir = Join-Path $PraxisInstallDir "dist"
  Write-Host "  已部署: $PraxisDistDir" -ForegroundColor Green
}

# ══════════════════════════════════════════════════════════════════
# Step 4: 注册 Claude Code hooks
# ══════════════════════════════════════════════════════════════════

if ($Global) {
  Write-Host "[4/5] 注册 Claude Code hooks (全局: ~/.claude/settings.json)..."
} elseif ($InstallMode -eq "dev") {
  Write-Host "[4/5] 注册 Claude Code hooks (开发: $TargetDir/.claude/settings.json)..."
} else {
  Write-Host "[4/5] 注册 Claude Code hooks (项目: $TargetDir/.claude/settings.json)..."
}

$bunPathFwd = $bunPath -replace '\\', '/'
$distDirFwd = $PraxisDistDir -replace '\\', '/'

$hooksConfig = @{
  SessionStart = @(@{
    matcher = ""
    hooks = @(@{
      type = "command"
      command = "try { & `"$bunPathFwd`" `"$distDirFwd/praxis-hook.js`" session_start `$env:CLAUDE_SESSION_ID 2>`$null } catch {} ; exit 0"
      shell = "powershell"
    })
  })
  UserPromptExpansion = @()
  UserPromptSubmit = @(@{
    matcher = ""
    hooks = @(@{
      type = "command"
      command = "try { & `"$bunPathFwd`" `"$distDirFwd/praxis-hook.js`" message_received `$env:CLAUDE_SESSION_ID 2>`$null } catch {} ; exit 0"
      shell = "powershell"
      timeout = 45
    })
  })
  Stop = @(@{
    matcher = ""
    hooks = @(@{
      type = "command"
      command = "try { & `"$bunPathFwd`" `"$distDirFwd/praxis-hook.js`" agent_end `$env:CLAUDE_SESSION_ID 2>`$null } catch {} ; exit 0"
      shell = "powershell"
    })
  })
  PreToolUse = @(@{
    matcher = ""
    hooks = @(@{
      type = "command"
      command = "try { & `"$bunPathFwd`" `"$distDirFwd/praxis-hook.js`" before_tool_call `$env:CLAUDE_SESSION_ID 2>`$null } catch {} ; exit 0"
      shell = "powershell"
    })
  })
  PostToolUse = @(@{
    matcher = ""
    hooks = @(@{
      type = "command"
      command = "try { & `"$bunPathFwd`" `"$distDirFwd/praxis-hook.js`" after_tool_call `$env:CLAUDE_SESSION_ID 2>`$null } catch {} ; exit 0"
      shell = "powershell"
    })
  })
  SessionEnd = @(@{
    matcher = ""
    hooks = @(@{
      type = "command"
      command = "try { & `"$bunPathFwd`" `"$distDirFwd/praxis-hook.js`" session_end `$env:CLAUDE_SESSION_ID 2>`$null } catch {} ; exit 0"
      shell = "powershell"
    })
  })
}

$praxisPermissions = @(
  "mcp__agentmemory__memory_audit",
  "mcp__agentmemory__memory_export",
  "mcp__agentmemory__memory_governance_delete",
  "mcp__agentmemory__memory_recall",
  "mcp__agentmemory__memory_save",
  "mcp__agentmemory__memory_sessions",
  "mcp__agentmemory__memory_smart_search",
  "PowerShell"
)

# 读取现有 settings.json (如存在)
$settings = @{}
if (Test-Path $SettingsFile) {
  try {
    $settings = Get-Content $SettingsFile -Raw | ConvertFrom-Json -AsHashtable
  } catch {
    Write-Host "  settings.json 格式错误，将重新创建" -ForegroundColor Yellow
    $settings = @{}
  }
}

if (-not $settings.ContainsKey("hooks")) { $settings.hooks = @{} }
# 追加 Praxis hooks (不覆盖用户已有的), 防止重复安装
foreach ($ht in $hooksConfig.Keys) {
  $praxisEntries = $hooksConfig[$ht]

  # 空数组 (如 UserPromptExpansion): 仅在 key 不存在时初始化
  if ($praxisEntries.Count -eq 0) {
    if (-not $settings.hooks.ContainsKey($ht)) { $settings.hooks[$ht] = @() }
    continue
  }

  if (-not $settings.hooks.ContainsKey($ht)) { $settings.hooks[$ht] = @() }

  # 检测是否已安装 (避免重复追加)
  $alreadyInstalled = $false
  foreach ($entry in $settings.hooks[$ht]) {
    if ($entry -is [hashtable] -and $entry.ContainsKey("hooks")) {
      foreach ($h in $entry.hooks) {
        if ($h -is [hashtable] -and $h.ContainsKey("command") -and $h.command -match "praxis-hook") {
          $alreadyInstalled = $true; break
        }
      }
    }
    if ($alreadyInstalled) { break }
  }

  if (-not $alreadyInstalled) { $settings.hooks[$ht] += $praxisEntries }
}

if (-not $settings.ContainsKey("permissions")) {
  $settings.permissions = @{ allow = @(); deny = @() }
}
if (-not $settings.permissions.ContainsKey("allow")) {
  $settings.permissions.allow = @()
}
$existingAllow = [System.Collections.ArrayList]::new(@($settings.permissions.allow))
foreach ($perm in $praxisPermissions) {
  if ($perm -notin $existingAllow) {
    $existingAllow.Add($perm) | Out-Null
  }
}
$settings.permissions.allow = @($existingAllow)

# 注册 /praxis 命令 (写入 .claude/commands/praxis.md)
$commandsDir = Join-Path (Split-Path -Parent $SettingsFile) "commands"
if (-not $DryRun) {
  if (-not (Test-Path $commandsDir)) { New-Item -ItemType Directory -Force $commandsDir | Out-Null }
  @"
---
description: Praxis CLI — ontology / status / audit
argument-hint: <ontology|status|audit>
---

Execute the shell command below and display its stdout verbatim:

```bash
bun "$distDirFwd/praxis-hook.js" praxis "`$ARGUMENTS"
```

The output is pre-formatted diagnostic text from the Praxis cognitive engine. Return it exactly as-is.
"@ | Set-Content (Join-Path $commandsDir "praxis.md") -Encoding UTF8
}

if ($DryRun) {
  Write-Host "  [DRY RUN] 将写入 $SettingsFile :"
  Write-Host ($settings | ConvertTo-Json -Depth 5)
} else {
  $settingsDir = Split-Path -Parent $SettingsFile
  if (-not (Test-Path $settingsDir)) {
    New-Item -ItemType Directory -Force $settingsDir | Out-Null
  }
  $settings | ConvertTo-Json -Depth 5 | Set-Content $SettingsFile -Encoding UTF8
  Write-Host "  hooks 已注册" -ForegroundColor Green
  Write-Host "    SessionStart     -> $distDirFwd/praxis-hook.js"
  Write-Host "    UserPromptSubmit -> $distDirFwd/praxis-hook.js"
  Write-Host "    Stop             -> $distDirFwd/praxis-hook.js"
  Write-Host "    PreToolUse       -> $distDirFwd/praxis-hook.js"
  Write-Host "    PostToolUse      -> $distDirFwd/praxis-hook.js"
  Write-Host "    SessionEnd       -> $distDirFwd/praxis-hook.js"
}

# ══════════════════════════════════════════════════════════════════
# Step 5: AgentMemory 配置 (强依赖 — 健康检查 + 引导安装)
# ══════════════════════════════════════════════════════════════════

Write-Host "[5/5] AgentMemory 配置..."

$DEFAULT_AM_URL = "http://localhost:3111"
$amRunning = $false

# 确定 AgentMemory URL
if ($AgentMemoryUrl) {
  $amUrl = $AgentMemoryUrl
  Write-Host "  使用指定 URL: $amUrl"
} elseif ($settings.ContainsKey("mcpServers") -and $settings.mcpServers.ContainsKey("agentmemory")) {
  $amUrl = $settings.mcpServers.agentmemory.url ?? $DEFAULT_AM_URL
  Write-Host "  已有 MCP 配置: $amUrl"
} else {
  $amUrl = $DEFAULT_AM_URL
}

# 始终做健康检查 (配置存在 ≠ 服务活着)
Write-Host "  健康检查 $amUrl ..."
try {
  $health = Invoke-RestMethod "$amUrl/agentmemory/livez" -TimeoutSec 5
  if ($health.status -eq "ok") {
    Write-Host "  AgentMemory 运行中 ✓" -ForegroundColor Green
    $amRunning = $true
  } else {
    Write-Host "  AgentMemory 返回异常状态: $($health.status)" -ForegroundColor Red
  }
} catch {
  Write-Host "  AgentMemory 无响应" -ForegroundColor Red
}

# 如果服务未运行 — 诊断+引导
if (-not $amRunning) {
  $amCli = Get-Command agentmemory -ErrorAction SilentlyContinue
  if (-not $amCli) {
    Write-Host "  AgentMemory CLI 未安装。"
    Write-Host "    安装: npm install -g @agentmemory/agentmemory"
  } else {
    Write-Host "  AgentMemory CLI 已安装但服务未启动。"
  }
  Write-Host "    启动: agentmemory"
  Write-Host "    或指定自定义 URL: .\scripts\install.ps1 -AgentMemoryUrl <url>"
}

# 写入/更新 MCP 配置
if ($amUrl -and -not $DryRun) {
  if (-not $settings.ContainsKey("mcpServers")) { $settings.mcpServers = @{} }
  $settings.mcpServers.agentmemory = @{
    type = "url"
    url = $amUrl
  }
  $settings | ConvertTo-Json -Depth 5 | Set-Content $SettingsFile -Encoding UTF8
  Write-Host "  MCP 配置已写入: $amUrl" -ForegroundColor Green
}

if (-not $amRunning) {
  Write-Host ""
  Write-Host "  ═══════════════════════════════════════════════════" -ForegroundColor Red
  Write-Host "  ⚠ AgentMemory 服务未运行 — Praxis 强依赖" -ForegroundColor Red
  Write-Host "  ═══════════════════════════════════════════════════" -ForegroundColor Red
  Write-Host ""
  Write-Host "  请先启动 AgentMemory，再启动 Claude Code。"
  Write-Host ""
}

# ══════════════════════════════════════════════════════════════════
# cron 注册 (Windows Task Scheduler)
# ══════════════════════════════════════════════════════════════════

if (-not $SkipCron -and -not $DryRun) {
  Write-Host ""
  Write-Host "  ⏰ 注册 cron tick (Windows Task Scheduler)..."

  if ($Global) {
    $taskName = "PraxisCronTick_Global"
  } else {
    $targetHash = [System.Convert]::ToBase64String(
      [System.Security.Cryptography.SHA256]::Create().ComputeHash(
        [System.Text.Encoding]::UTF8.GetBytes($TargetDir)
      )
    ).Substring(0, 8) -replace '[+/=]', 'X'
    $taskName = "PraxisCronTick_$targetHash"
  }

  $taskExists = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if (-not $taskExists) {
    $action = New-ScheduledTaskAction -Execute $bunPath `
      -Argument "$distDirFwd/praxis-cron.js cron-tick"
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 30)
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" `
      -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
      -Principal $principal -Description "Praxis 认知引擎定时任务 ($InstallMode)" | Out-Null
    Write-Host "  cron tick 已注册 (Task: $taskName, 每 30 分钟)" -ForegroundColor Green
  } else {
    Write-Host "  已存在 (Task: $taskName)，跳过" -ForegroundColor Yellow
  }
}

# ══════════════════════════════════════════════════════════════════
# 完成
# ══════════════════════════════════════════════════════════════════

Write-Host ""
Write-Host "  Praxis 安装完成!" -ForegroundColor Green
Write-Host ""

if ($Global) {
  Write-Host "  安装类型: 全局 — 所有项目共用 ~\.praxis\"
} elseif ($InstallMode -eq "dev") {
  Write-Host "  安装类型: 开发模式 — 引用源码 dist\"
} else {
  Write-Host "  安装类型: 项目级 — hooks 仅在 $TargetDir 生效"
}
Write-Host "  Praxis 目录: $PraxisInstallDir"
Write-Host "  构建产物:    $PraxisDistDir"

Write-Host ""
if ($Global) {
  Write-Host "  卸载: .\scripts\uninstall.ps1 -Global"
} elseif ($InstallMode -eq "dev") {
  Write-Host "  卸载: .\scripts\uninstall.ps1 -Target '$TargetDir'"
} else {
  Write-Host "  卸载: $PraxisHome\scripts\uninstall.ps1 -Target '$TargetDir'"
}

Write-Host ""
Write-Host "  下一步:"
Write-Host "    1. 重启 Claude Code"
Write-Host "    2. 首次 session_start 将自动初始化 Praxis 认知引擎"
Write-Host ""
