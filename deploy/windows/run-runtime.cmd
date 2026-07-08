@echo off
REM Desktop launcher: keep a visible console with runtime logs.
REM Closing this window stops glowbe-runtime.
REM Ubuntu Server / systemd: use deploy/systemd instead (no console needed).

setlocal
cd /d "%~dp0..\.."
if not exist "config.toml" (
  echo config.toml not found in %CD%
  echo Copy config.example.toml to config.toml first.
  pause
  exit /b 1
)

set "EXE=%CD%\runtime\target\release\glowbe-runtime.exe"
if not exist "%EXE%" (
  echo Build release first: cd runtime ^&^& cargo build --release
  pause
  exit /b 1
)

echo Glowbe runtime — close this window to stop the server.
echo Working directory: %CD%
"%EXE%" "%CD%\config.toml"
echo.
echo Runtime exited with code %ERRORLEVEL%.
pause
