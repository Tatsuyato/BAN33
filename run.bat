@echo off
title Bun.js Setup Script

:checkBun
echo Checking if Bun.js is installed...
bun --version 2>nul
if %ERRORLEVEL% neq 0 (
    echo Bun.js is not installed.
    goto :askInstallBun
) else (
    echo Bun.js is already installed.
    goto :proceedWithInstall
)

:askInstallBun
set "choice="
set /p choice="Bun.js is not installed. Do you want to install it? (y/n): "
if /i "%choice%"=="y" (
    echo Installing Bun.js...
    goto :installBun
) else (
    echo Exiting...
    exit /b 0
)

:installBun
powershell -Command "irm https://bun.sh/install.ps1 | iex" 2>nul
if %ERRORLEVEL% neq 0 (
    echo Error installing Bun.js.
    exit /b 1
) else (
    echo Bun.js installed successfully!
    goto :proceedWithInstall
)

:proceedWithInstall
echo Now installing npm modules...
npm i
if %ERRORLEVEL% neq 0 (
    echo Error during npm install.
    exit /b 1
) else (
    echo Modules installed successfully!
    goto :startServer
)

:startServer
echo Starting server...
echo Server started successfully!
echo Go to http://localhost:3000/
start "" cmd /c "npm start" || (
    echo Error starting server.
    exit /b 1
)
echo Server should be running. The script will continue running...
:loop
timeout /t 60 >nul
goto :loop
pause