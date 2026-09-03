@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [Travel Camera] Node.js 24 or newer is required.
  echo Install Node.js, then run this launcher again.
  echo.
  pause
  exit /b 1
)

node scripts\launch-local.mjs %*
set EXIT_CODE=%ERRORLEVEL%

if not "%EXIT_CODE%"=="0" (
  echo.
  echo [Travel Camera] The launcher exited with code %EXIT_CODE%.
  pause
)

exit /b %EXIT_CODE%
