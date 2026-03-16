param(
  [switch]$SkipInstall,
  [switch]$SkipBuild,
  [switch]$SkipTests,
  [switch]$SkipDoctor,
  [switch]$Hooks,
  [Parameter(Position = 0)]
  [ValidateSet('auto', 'codex', 'cursor', 'claude')]
  [string[]]$Hosts = @('auto')
)

$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
  $nodeCommand = $null
  $resolvedNode = Get-Command node -ErrorAction SilentlyContinue
  if ($resolvedNode) {
    $nodeCommand = $resolvedNode.Source
  } else {
    $resolvedNpm = Get-Command npm -ErrorAction SilentlyContinue
    if ($resolvedNpm) {
      $candidate = Join-Path (Split-Path $resolvedNpm.Source -Parent) 'node.exe'
      if (Test-Path $candidate) {
        $nodeCommand = $candidate
      }
    }

    if (-not $nodeCommand -and (Test-Path 'C:\Program Files\nodejs\node.exe')) {
      $nodeCommand = 'C:\Program Files\nodejs\node.exe'
    }
  }

  if (-not $nodeCommand) {
    throw 'Could not find node.exe. Install Node.js 22 or 24 LTS, or add node to PATH before running setup.ps1.'
  }

  if (-not $SkipInstall) { npm install }
  if (-not $SkipBuild) { npm run build }
  if (-not $SkipTests) { npm test }
  if (-not $SkipDoctor) { npm run doctor }

  foreach ($targetHost in $Hosts) {
    if ($Hooks) {
      & $nodeCommand .\dist\index.js setup $targetHost --hooks
    } else {
      & $nodeCommand .\dist\index.js setup $targetHost
    }
  }
} finally {
  Pop-Location
}
