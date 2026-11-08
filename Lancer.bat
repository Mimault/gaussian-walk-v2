@echo off
rem Gaussian Walk V2 sur le PC : double-clic pour lancer l'app en pleine definition.
chcp 65001 >nul
title Gaussian Walk V2
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js n'est pas installé : version LTS sur https://nodejs.org
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installation des briques de l'app...
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

echo.
echo Pour arrêter : fermer cette fenêtre.
echo.
rem Ouvre le navigateur par defaut de Windows
call npm run dev -- --open
pause
