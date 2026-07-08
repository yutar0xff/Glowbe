# Desktop launcher: keep a visible console with runtime logs.
# Closing this window stops glowbe-runtime.
# Ubuntu Server / systemd: use deploy/systemd instead (no console needed).

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $RepoRoot

if (-not (Test-Path "config.toml")) {
    Write-Host "config.toml not found in $RepoRoot"
    Write-Host "Copy config.example.toml to config.toml first."
    Read-Host "Press Enter to exit"
    exit 1
}

$Exe = Join-Path $RepoRoot "runtime\target\release\glowbe-runtime.exe"
if (-not (Test-Path $Exe)) {
    Write-Host "Build release first: cd runtime; cargo build --release"
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "Glowbe runtime — close this window to stop the server."
Write-Host "Working directory: $RepoRoot"
& $Exe (Join-Path $RepoRoot "config.toml")
Write-Host ""
Write-Host "Runtime exited with code $LASTEXITCODE."
Read-Host "Press Enter to exit"
