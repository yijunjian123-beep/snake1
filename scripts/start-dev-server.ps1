$ErrorActionPreference = "Stop"

$port = 5173
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

$stdoutLog = Join-Path $logDir "dev-server.out.log"
$stderrLog = Join-Path $logDir "dev-server.err.log"

function Get-NodeExe {
  $nodeCandidates = @(
    (Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"),
    "C:\Users\happyelements\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe",
    "node"
  )

  return $nodeCandidates | Where-Object {
    $_ -eq "node" -or (Test-Path $_)
  } | Select-Object -First 1
}

function Get-ViteEntry {
  return Join-Path $repoRoot "node_modules\vite\bin\vite.js"
}

function Start-ViteServer {
  $nodeExe = Get-NodeExe
  if (-not $nodeExe) {
    throw "Node executable not found."
  }

  $viteEntry = Get-ViteEntry
  if (-not (Test-Path $viteEntry)) {
    throw "Vite entry not found: $viteEntry"
  }

  Start-Process -FilePath $nodeExe `
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
  try {
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
  } catch {
    $stamp = Get-Date -Format o
    try {
      Add-Content -LiteralPath $stderrLog -Value "$stamp $($_.Exception.Message)"
    } catch {
      # Keep trying even if logging fails.
    }

    Start-Sleep -Seconds 5
  }
}
