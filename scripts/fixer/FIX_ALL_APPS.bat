@echo off
title 3S Verse - One-Click App Repair
echo.
echo  ============================================
echo    3S VERSE - ONE-CLICK APP REPAIR
echo    Startup crash (NameError) fix - all apps
echo  ============================================
echo.
where python >nul 2>nul
if %errorlevel%==0 (
    python "%~dp0Fix_All_Apps.py"
    goto done
)
where py >nul 2>nul
if %errorlevel%==0 (
    py -3 "%~dp0Fix_All_Apps.py"
    goto done
)
echo  Python nahi mila. Jis Python se aap apps chalate ho,
echo  usi se yeh command chalao:
echo      python Fix_All_Apps.py
echo.
pause
exit /b 1
:done
echo.
pause
