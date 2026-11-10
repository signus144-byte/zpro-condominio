@echo off
chcp 65001 >nul
title Vecinos ZPro: instalar el piloto en el servidor de los bots
cd /d "%~dp0"
"C:\Trading Bot Ani\.venv\Scripts\python.exe" desplegar_vecinos.py
echo.
pause
