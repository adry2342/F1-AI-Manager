@echo off
rem Arranca el servidor del juego (un jugador y multijugador) y abre el navegador en http://localhost:8765/
cd /d "%~dp0"
if exist F1-AI-Manager.exe (
  F1-AI-Manager.exe %*
) else (
  node server.js %*
)
pause
