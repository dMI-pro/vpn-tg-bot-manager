#!/bin/bash

# Скрипт для деплоя VPN TG Bot Manager

echo "🚀 Начинаю процесс обновления..."

# 1. Получаем последние изменения
echo "📥 Получение обновлений из Git..."
git pull

# 2. Устанавливаем зависимости
echo "📦 Установка зависимостей..."
npm install

# 3. Собираем проект
echo "🏗 Сборка проекта..."
npm run build

# 4. Перезапускаем через PM2
if command -v pm2 &> /dev/null
then
    echo "🔄 Перезапуск через PM2..."
    pm2 restart vpn-bot || pm2 start dist/index.js --name "vpn-bot"
else
    echo "⚠️ PM2 не найден. Пожалуйста, перезапустите бота вручную или установите PM2."
fi

echo "✅ Деплой завершен успешно!"
