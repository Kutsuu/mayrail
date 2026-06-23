@echo off
cd /d "%~dp0"
set OPEN_BROWSER=1
node local-server.js
pause
