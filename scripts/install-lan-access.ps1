param(
  [int]$InterfaceIndex = 6,
  [string]$IPAddress = "10.160.104.97",
  [string]$SubnetMask = "255.255.252.0",
  [string]$Gateway = "10.160.104.1",
  [string[]]$DnsServers = @("10.160.86.6", "10.160.2.6"),
  [string]$TaskName = "NeonSerpentLanDevServer"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$startScript = Join-Path $repoRoot "scripts\start-dev-server.ps1"
if (-not (Test-Path $startScript)) {
  throw "Missing startup script: $startScript"
}

Write-Host "Configuring static IPv4 address for interface index $InterfaceIndex..."
& netsh interface ipv4 set address name="$InterfaceIndex" static $IPAddress $SubnetMask $Gateway 1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Failed to set static IPv4 address."
}

if ($DnsServers.Count -gt 0) {
  Write-Host "Updating DNS servers..."
  Set-DnsClientServerAddress -InterfaceIndex $InterfaceIndex -ServerAddresses $DnsServers
}

$ruleName = "Neon Serpent Vite 5173"
if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
  Write-Host "Adding firewall rule..."
  New-NetFirewallRule `
    -DisplayName $ruleName `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort 5173 `
    -Profile Domain,Private,Public | Out-Null
}

$powershellExe = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$taskArgs = @(
  "/Create"
  "/TN", $TaskName
  "/SC", "ONSTART"
  "/RU", "SYSTEM"
  "/RL", "HIGHEST"
  "/F"
  "/TR", "`"$powershellExe`" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$startScript`""
)

Write-Host "Registering startup task..."
& schtasks.exe @taskArgs | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Failed to register startup task."
}

Write-Host "Starting task now..."
& schtasks.exe /Run /TN $TaskName | Out-Null

Write-Host "LAN access setup completed."
