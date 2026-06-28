# Praxis Installer — Windows (PowerShell)
# v1.0.0.0
#
# 一键安装 Praxis 到 Claude Code:
#   1. 检测 bun 运行时
#   2. 配置 AgentMemory MCP 连接
#   3. 注册 Claude Code hooks (SessionStart / Stop / UserPromptSubmit)
#   4. 注册 Windows Task Scheduler cron-tick (可选)
#
# 用法: .\scripts\install.ps1

param(
  [switch]$SkipCron,         # 跳过 cron 注册
  [string]$AgentMemoryUrl = "",  # AgentMemory 网页 URL (留空则跳过)
  [switch]$DryRun             # 仅预览，不写入
)

$ErrorActionPreference = "Stop"

Write-Host @"

  ╔═══════════════════════════════════════╗
  ║     Praxis v1.0.0.0 — Installer      ║
  ║  AI 认知操作系统 — Windows Edition     ║
  ╚═══════════════════════════════════════╝

"@

# ══════════════════════════════════════════════════════════════════
# Step 1: 检测 bun
# ══════════════════════════════════════════════════════════════════

Write-Host "[1/4] 检测 bun 运行时..."

$bunPath = "$env:USERPROFILE\.bun\bin\bun.exe"
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
# Step 2: 安装 npm 依赖
# ══════════════════════════════════════════════════════════════════

Write-Host "[2/4] 安装依赖..."

if (-not $DryRun) {
  & $bunPath install --production 2>$null
}
Write-Host "  依赖就绪" -ForegroundColor Green

# ══════════════════════════════════════════════════════════════════
# Step 3: 配置 Claude Code hooks
# ══════════════════════════════════════════════════════════════════

Write-Host "[3/4] 注册 Claude Code hooks..."

$settingsPath = ".claude\settings.json"
$projectDir = (Get-Location).Path

# 读取现有 settings.json (如存在)
$settings = @{}
if (Test-Path $settingsPath) {
  try {
    $settings = Get-Content $settingsPath -Raw | ConvertFrom-Json -AsHashtable
  } catch {
    Write-Host "  settings.json 格式错误，将覆盖" -ForegroundColor Yellow
  }
}

# hooks 配置
$hooksConfig = @{
  SessionStart = @(@{
    matcher = ""
    hooks = @(@{
      type = "command"
      command = "try { & `"$bunPath`" scripts/praxis-hook.ts session_start `"`$env:CLAUDE_SESSION_ID`" 2>`$null } catch {} ; exit 0"
      shell = "powershell"
    })
  })
  UserPromptExpansion = @()
  UserPromptSubmit = @(@{
    matcher = ""
    hooks = @(@{
      type = "command"
      command = "try { & `"$bunPath`" scripts/praxis-hook.ts message_received `"`$env:CLAUDE_SESSION_ID`" 2>`$null } catch {} ; exit 0"
      shell = "powershell"
      timeout = 45
    })
  })
  Stop = @(@{
    matcher = ""
    hooks = @(@{
      type = "command"
      command = "try { & `"$bunPath`" scripts/praxis-hook.ts agent_end `"`$env:CLAUDE_SESSION_ID`" 2>`$null } catch {} ; exit 0"
      shell = "powershell"
    })
  })
}

# 合并 hooks 配置（保留用户已有的其他 hooks）
if (-not $settings.ContainsKey("hooks")) { $settings.hooks = @{} }
$settings.hooks = $hooksConfig

# 保留已有的 permissions
if (-not $settings.ContainsKey("permissions")) {
  $settings.permissions = @{
    allow = @(
      "mcp__agentmemory__memory_audit",
      "mcp__agentmemory__memory_export",
      "mcp__agentmemory__memory_governance_delete",
      "mcp__agentmemory__memory_recall",
      "mcp__agentmemory__memory_save",
      "mcp__agentmemory__memory_sessions",
      "mcp__agentmemory__memory_smart_search",
      "PowerShell"
    )
  }
}

if ($DryRun) {
  Write-Host "  [DRY RUN] 将写入 .claude/settings.json:"
  Write-Host ($settings | ConvertTo-Json -Depth 5)
} else {
  $settings | ConvertTo-Json -Depth 5 | Set-Content $settingsPath -Encoding UTF8
  Write-Host "  hooks 已注册到 .claude/settings.json" -ForegroundColor Green
  Write-Host "    SessionStart  → scripts/praxis-hook.ts session_start"
  Write-Host "    UserPromptSubmit → scripts/praxis-hook.ts message_received"
  Write-Host "    Stop         → scripts/praxis-hook.ts agent_end"
}

# ══════════════════════════════════════════════════════════════════
# Step 4: AgentMemory 配置 (可选)
# ══════════════════════════════════════════════════════════════════

Write-Host "[4/4] AgentMemory 配置..."

$amImported = $false
if ($settings.ContainsKey("mcpServers") -and $settings.mcpServers.ContainsKey("agentmemory")) {
  Write-Host "  AgentMemory MCP 已配置" -ForegroundColor Green
  $amImported = $true
} elseif ($AgentMemoryUrl) {
  if (-not $DryRun) {
    if (-not $settings.ContainsKey("mcpServers")) { $settings.mcpServers = @{} }
    $settings.mcpServers.agentmemory = @{
      type = "url"
      url = $AgentMemoryUrl
    }
    $settings | ConvertTo-Json -Depth 5 | Set-Content $settingsPath -Encoding UTF8
    Write-Host "  AgentMemory MCP 已配置: $AgentMemoryUrl" -ForegroundColor Green
    $amImported = $true
  }
} else {
  Write-Host "  跳过 (未提供 --AgentMemoryUrl)。Praxis 将以 local-cache 降级模式运行。" -ForegroundColor Yellow
  Write-Host "  要启用完整功能，请配置 AgentMemory MCP: --AgentMemoryUrl <url>"
}

# ══════════════════════════════════════════════════════════════════
# 完成
# ══════════════════════════════════════════════════════════════════

Write-Host ""
Write-Host "  Praxis 安装完成!" -ForegroundColor Green
Write-Host ""

if (-not (Test-Path ".claude\settings.json")) {
  Write-Host "  ⚠ .claude/settings.json 未找到 — 请确保在 Praxis 项目根目录下运行此脚本"
} elseif (-not $amImported) {
  Write-Host "  ⚠ AgentMemory 未配置。Praxis 将以 local-cache 降级模式运行。"
  Write-Host "    要启用完整功能，请设置 --AgentMemoryUrl 或手动配置 MCP。"
}

Write-Host ""
Write-Host "  下一步:"
Write-Host "    1. 重启 Claude Code session (CTRL+C 后重新运行 claude)"
Write-Host "    2. 首次 session_start 将自动初始化 Praxis 认知引擎"
Write-Host "    3. 阅读 docs/GETTING_STARTED.md"
Write-Host ""

if (-not $SkipCron) {
  Write-Host "  ⏰ 注册 cron tick (Windows Task Scheduler)..."
  $taskName = "PraxisCronTick"
  $taskExists = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if (-not $taskExists) {
    if (-not $DryRun) {
      $action = New-ScheduledTaskAction -Execute $bunPath `
        -Argument "scripts/praxis-cron.ts cron-tick" `
        -WorkingDirectory $projectDir
      $trigger = New-ScheduledTaskTrigger -Daily -At "09:00" -RepetitionInterval (New-TimeSpan -Minutes 30) -RepetitionDuration (New-TimeSpan -Hours 24)
      $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
      Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Description "Praxis 认知引擎定时任务" | Out-Null
    }
    Write-Host "  cron tick 已注册 (每 30 分钟)" -ForegroundColor Green
  } else {
    Write-Host "  已存在，跳过" -ForegroundColor Yellow
  }
}
