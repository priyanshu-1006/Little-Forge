@echo off
setlocal
cd /d "%~dp0"
if not exist "dist\extension.cjs" (
  call npm.cmd run build
  if errorlevel 1 exit /b 1
)
set "FORGE_TARGET=%~1"
if not defined FORGE_TARGET set "FORGE_TARGET=%CD%\evaluation\workspaces\flask"
if not exist "%FORGE_TARGET%" set "FORGE_TARGET=%CD%"
call code.cmd --new-window --extensionDevelopmentPath="%CD%" "%FORGE_TARGET%"
