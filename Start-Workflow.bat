@echo off
setlocal
set "WORKSHOP_DIR=%~dp0app"
set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
set "WORKSHOP_URL=http://127.0.0.1:4180"

if not exist "%WORKSHOP_DIR%\server.mjs" (
  echo Workflow-Server nicht gefunden:
  echo %WORKSHOP_DIR%\server.mjs
  pause
  exit /b 1
)
if not exist "%NODE_EXE%" (
  echo Node.js wurde nicht gefunden:
  echo %NODE_EXE%
  pause
  exit /b 1
)

powershell.exe -NoProfile -Command "try { $null = Invoke-WebRequest -Uri 'http://127.0.0.1:4180/' -UseBasicParsing -TimeoutSec 2; exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
  echo Starte Workflow aus:
  echo %WORKSHOP_DIR%
  start "Workflow Server" /D "%WORKSHOP_DIR%" "%NODE_EXE%" --watch server.mjs
  for /L %%i in (1,1,10) do (
    powershell.exe -NoProfile -Command "try { $null = Invoke-WebRequest -Uri 'http://127.0.0.1:4180/' -UseBasicParsing -TimeoutSec 1; exit 0 } catch { exit 1 }" >nul 2>&1 && goto :open
    timeout /t 1 /nobreak >nul
  )
  echo Workflow hat innerhalb von 10 Sekunden nicht geantwortet.
  echo Pruefe das Serverfenster auf Fehler wie EADDRINUSE.
  pause
  exit /b 1
) else (
  echo Workflow laeuft bereits. Es wird kein zweiter Server gestartet.
)

:open
start "" "%WORKSHOP_URL%"
endlocal
