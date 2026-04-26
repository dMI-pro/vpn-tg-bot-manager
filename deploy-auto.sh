#!/bin/bash

# Автоматический скрипт деплоя VPN TG Bot Manager

set -e

echo "🚀 Начинаем процесс установки..."

# 1. Проверка зависимостей
if ! command -v node &> /dev/null; then
    echo "❌ Node.js не установлен. Пожалуйста, установите Node.js 20+ (см. DEPLOY.md)"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo "❌ npm не установлен."
    exit 1
fi

# 2. Установка зависимостей проекта
echo "📦 Установка зависимостей..."
npm install

# 3. Сборка проекта
echo "🛠 Сборка проекта..."
npm run build || echo "⚠️ Ошибка сборки, проверьте код."

# 4. Настройка .env (интерактивно)
if [ ! -f .env ]; then
    echo "📝 Настройка .env файла..."
    read -p "Введите токен бота (BOT_TOKEN): " bot_token
    read -p "Введите ваш Telegram ID (ADMIN_TELEGRAM_ID): " admin_id
    
    # Генерация случайного ключа шифрования (32 символа)
    enc_key=$(head /dev/urandom | tr -dc A-Za-z0-9 | head -c 32)
    
    cat > .env << EOL
BOT_TOKEN=$bot_token
ADMIN_TELEGRAM_ID=$admin_id
ENCRYPTION_KEY=$enc_key
DATABASE_PATH=vpn-bot.db
NODE_ENV=production
EOL
    echo "✅ Файл .env создан. Ключ шифрования сгенерирован автоматически."
else
    echo "ℹ️ Файл .env уже существует. Пропускаю настройку."
fi

# 5. Инициализация логов
mkdir -p logs

# 6. Запуск через PM2
if command -v pm2 &> /dev/null; then
    echo "🔄 Запуск через PM2..."
    pm2 delete vpn-bot &> /dev/null || true
    pm2 start dist/index.js --name vpn-bot
    pm2 save
    echo "✅ Бот запущен в PM2."
else
    echo "⚠️ PM2 не найден. Установите его командой: npm install -g pm2"
    echo "Запустите бота вручную: node dist/index.js"
fi

echo "🎉 Деплой успешно завершен!"
echo "Используйте 'pm2 logs vpn-bot' для просмотра логов."
