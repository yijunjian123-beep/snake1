$ErrorActionPreference = "Stop"

$port = 5174
$repoRoot = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $repoRoot ".codex\lan-access"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Test-PortOpen {
  param(
    [int]$Port
  )

  try {
    $client = [System.Net.Sockets.TcpClient]::new()
    $async = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne(300, $false)) {
      $client.Close()
      return $false
    }

    $client.EndConnect($async) | Out-Null
    $client.Close()
    return $true
  } catch {
    return $false
  }
}

$nodeCandidates = @(
  Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe",
  "C:\Users\happyelements\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe",
  "node"
)

$nodeExe = $nodeCandidates | Where-Object {
  $_ -eq "node" -or (Test-Path $_)
} | Select-Object -First 1

if (-not $nodeExe) {
  throw "Node executable not found."
}

$viteEntry = Join-Path $repoRoot "node_modules\vite\bin\vite.js"
if (-not (Test-Path $viteEntry)) {
  throw "Vite entry not found: $viteEntry"
}

$stdoutLog = Join-Path $logDir "dev-server.out.log"
$stderrLog = Join-Path $logDir "dev-server.err.log"

function Start-ViteServer {
  return Start-Process -FilePath $nodeExe `
    -ArgumentList @(
      $viteEntry,
      "--host",
      "0.0.0.0",
      "--port",
      $port,
      "--strictPort"
    ) `
    -WorkingDirectory $repoRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -PassThru
}

while ($true) {
  if (Test-PortOpen -Port $port) {
    Start-Sleep -Seconds 5
    continue
  }

  $process = Start-ViteServer
  $deadline = [DateTime]::UtcNow.AddSeconds(10)

  while ([DateTime]::UtcNow -lt $deadline) {
    if (Test-PortOpen -Port $port) {
      break
    }

    if (-not (Get-Process -Id $process.Id -ErrorAction SilentlyContinue)) {
      break
    }

    Start-Sleep -Milliseconds 250
  }

  if (-not (Test-PortOpen -Port $port)) {
    Start-Sleep -Seconds 3
  }
}
