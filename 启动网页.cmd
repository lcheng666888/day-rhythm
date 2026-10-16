@echo off
setlocal
cd /d "%~dp0"
set "DAY_RHYTHM_NODE=node"
where node >nul 2>nul
if errorlevel 1 set "DAY_RHYTHM_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not "%DAY_RHYTHM_NODE%"=="node" if not exist "%DAY_RHYTHM_NODE%" (
  echo Node.js was not found. Please install Node.js 18 or newer.
  pause
  exit /b 1
)
"%DAY_RHYTHM_NODE%" server.mjs --open
if errorlevel 1 pause
