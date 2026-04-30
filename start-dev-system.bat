@echo off
REM ============================================================
REM  start-dev.bat
REM  Launches all three StudyLink dev servers in separate windows
REM
REM  Save this file in:
REM    C:\Users\rhod_\Documents\StudyLinkLeadQualification\
REM
REM  Then double-click to run.
REM ============================================================

REM --- Edit this path if your project ever moves ---
set ROOT=C:\Users\rhod_\Documents\StudyLinkLeadQualification

echo.
echo  Starting StudyLink dev environment...
echo  Project root: %ROOT%
echo.

REM --- 1. Start the backend FIRST so frontends can reach it ---
echo  [1/3] Launching Server (port 5000)...
start "StudyLink - Server (5000)" cmd /k "cd /d %ROOT%\Server && npm run dev"

REM Pause a few seconds so the server is up before frontends try to connect
timeout /t 4 /nobreak > nul

REM --- 2. Start the Client (LQ - student-facing) on port 3000 ---
echo  [2/3] Launching Client / LeadQualification (port 3000)...
start "StudyLink - Client (3000)" cmd /k "cd /d %ROOT%\Client && npm run dev"

REM Small pause to keep startup logs readable
timeout /t 2 /nobreak > nul

REM --- 3. Start the LeadManagement (staff console) on port 3001 ---
echo  [3/3] Launching LeadManagement (port 3001)...
start "StudyLink - LeadManagement (3001)" cmd /k "cd /d %ROOT%\LeadManagement && npm run dev"

echo.
echo  ============================================================
echo   All three servers launching in their own windows:
echo.
echo     Server          http://localhost:5000
echo     Client (LQ)     http://localhost:3000
echo     LeadManagement  http://localhost:3001
echo.
echo   To stop a server: click its window, press Ctrl+C, then Y.
echo  ============================================================
echo.
timeout /t 6 /nobreak > nul
