@echo off
setlocal
cd /d "%~dp0"
set "PORT=8000"

where python >nul 2>nul
if %errorlevel%==0 (
    start "" "http://localhost:%PORT%"
    python -m http.server %PORT% --bind 127.0.0.1
    goto :eof
)

where py >nul 2>nul
if %errorlevel%==0 (
    start "" "http://localhost:%PORT%"
    py -m http.server %PORT% --bind 127.0.0.1
    goto :eof
)

echo Python nie jest dostepny. Uruchamianie wbudowanego serwera PowerShell...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-server.ps1" -Port %PORT%
endlocal
