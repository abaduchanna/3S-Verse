@echo off
title GFH Inventory Backup
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERROR] Python nahi mila. python.org se Python 3 install karo.
  echo.
  pause
  exit /b 1
)
python GFH_Inventory_Upload.py --backup
echo.
pause
