@echo off
chcp 65001 >nul
title Vecinos ZPro: clave nueva para la consola
cd /d "%~dp0"
"C:\Trading Bot Ani\.venv\Scripts\python.exe" desplegar_vecinos.py --nueva-clave
echo.
pause
