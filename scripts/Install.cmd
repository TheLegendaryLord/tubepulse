@echo off
setlocal DisableDelayedExpansion
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install.ps1"
set "exitCode=%errorlevel%"
echo.
if not "%exitCode%"=="0" echo TubePulse setup could not finish. See the error above.
pause
exit /b %exitCode%
