@echo off
cd /d "%~dp0"
"%LOCALAPPDATA%\Video Downloader\.venv\Scripts\python.exe" scripts\uninstall.py --keep-runtime
if errorlevel 1 goto done
rmdir /s /q "%LOCALAPPDATA%\Video Downloader"
:done
pause
