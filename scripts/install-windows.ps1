param([switch]$EngineOnly)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$uvCommand = Get-Command uv -ErrorAction SilentlyContinue
$temporary = $null
try {
  if ($uvCommand) {
    $uvPath = $uvCommand.Source
  } else {
    $temporary = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString())
    New-Item -ItemType Directory -Path $temporary | Out-Null
    $installer = Join-Path $temporary 'uv-install.ps1'
    Invoke-WebRequest -Uri 'https://astral.sh/uv/install.ps1' -OutFile $installer
    $env:UV_INSTALL_DIR = Join-Path $temporary 'bin'
    $env:UV_NO_MODIFY_PATH = '1'
    & $installer
    $uvPath = Join-Path $env:UV_INSTALL_DIR 'uv.exe'
  }
  $arguments = @('run', '--python', '3.13', '--no-project', 'scripts/install.py', '--uv', $uvPath)
  if ($EngineOnly) { $arguments += '--engine-only' }
  & $uvPath @arguments
  if ($LASTEXITCODE -ne 0) { throw 'Setup did not finish. See the message above.' }
} finally {
  if ($temporary) { Remove-Item -Recurse -Force $temporary }
}
