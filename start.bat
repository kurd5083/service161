@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js не найден. Установите его с https://nodejs.org
  pause
  exit /b 1
)
node server.js
echo.
echo Сервер остановлен.
pause
