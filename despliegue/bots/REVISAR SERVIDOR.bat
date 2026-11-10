@echo off
chcp 65001 >nul
title Vecinos ZPro: revisar el servidor del piloto
cd /d "%~dp0"
"C:\Trading Bot Ani\.venv\Scripts\python.exe" desplegar_vecinos.py --revisar
echo.
pause
