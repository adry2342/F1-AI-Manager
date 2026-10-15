#!/usr/bin/env bash
# Arranca el servidor del juego (un jugador y multijugador) y abre el navegador en http://localhost:8765/
# Uso: ./jugar.sh [puerto]
cd "$(dirname "$0")"
if [ -f ./F1-AI-Manager ]; then
  chmod +x ./F1-AI-Manager 2>/dev/null
  exec ./F1-AI-Manager "$@"
fi
if command -v node >/dev/null 2>&1; then
  exec node server.js "$@"
fi
echo "Hace falta Node.js (https://nodejs.org) o el ejecutable F1-AI-Manager junto a este script."
exit 1
