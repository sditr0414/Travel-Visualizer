@echo off
setlocal
cd /d "%~dp0.."

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-windows-shortcut.ps1"
set EXIT_CODE=%ERRORLEVEL%

echo.
if "%EXIT_CODE%"=="0" (
  echo Desktop shortcut setup completed.
) else (
  echo Desktop shortcut setup failed with code %EXIT_CODE%.
)
pause
exit /b %EXIT_CODE%
