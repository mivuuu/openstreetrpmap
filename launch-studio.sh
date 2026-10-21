#!/usr/bin/env bash
set -e
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

echo "=================================================="
echo "🗺️  Запуск OpenStreetRP Map Studio..."
echo "=================================================="
echo "Открывается редактор карты в браузере..."
echo "Нажмите Ctrl+C в этом окне для завершения работы."

pnpm studio
