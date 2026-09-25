@echo off
title GFH Inventory Uploader
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERROR] Python was not found. Install Python 3 from python.org
  echo         and do NOT forget to tick "Add python.exe to PATH".
  echo.
  pause
  exit /b 1
)
python GFH_Inventory_Upload.py %*
echo.
pause
