# Restart the DSH desktop app so a changed profile composition takes effect.
#
# Why this exists: the `desktop` profile is owned exclusively by the Electron
# application. A plugin added to `dsh.profile.bundles` while the app is running
# is only read at startup, and the CLI refuses to boot that profile
# ("profile 'desktop' is managed exclusively by the Electron application").
# So the only way to load a newly selected bundle is to restart the app.
#
# What it does, in order: stop every "DeepSeek Harness" process, wait for the
# process table to drain, start the executable again, wait, and record what
# happened in %TEMP%\dsh-restart.log. Sessions are stored on disk, so the
# conversation survives the restart.
#
# Run: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/restart-dsh-app.ps1

[CmdletBinding()]
param(
    [string] $Exe = "$env:LOCALAPPDATA\Programs\DeepSeek Harness\DeepSeek Harness.exe",
    [int] $StartDelaySeconds = 0
)

$ErrorActionPreference = 'Stop'
$log = Join-Path $env:TEMP 'dsh-restart.log'

function Write-Log {
    param([string] $Message)
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Write-Host $line
    Add-Content -LiteralPath $log -Value $line -Encoding utf8
}

if ($StartDelaySeconds -gt 0) {
    Write-Log "waiting $StartDelaySeconds second(s) before restarting"
    Start-Sleep -Seconds $StartDelaySeconds
}

if (-not (Test-Path -LiteralPath $Exe)) {
    Write-Log "executable not found: $Exe"
    exit 1
}

$running = @(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue)
Write-Log ("stopping {0} process(es)" -f $running.Count)
$running | Stop-Process -Force -ErrorAction SilentlyContinue

for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500
    if (@(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue).Count -eq 0) { break }
}

Write-Log "starting the application"
Start-Process -FilePath $Exe

Start-Sleep -Seconds 10
$after = @(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue)
Write-Log ("running again: {0} process(es)" -f $after.Count)

if ($after.Count -eq 0) {
    Write-Log "the app did not come back; starting it once more"
    Start-Process -FilePath $Exe
    Start-Sleep -Seconds 8
    $after = @(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue)
    Write-Log ("second attempt: {0} process(es)" -f $after.Count)
}

Write-Log 'done'
