# Инструкция по деплою VPN TG Bot Manager

Данное руководство поможет вам развернуть бота на отдельном VPS сервере.

## 1. Требования к серверу
Для стабильной работы бота рекомендуется:
- **ОС:** Ubuntu 22.04 LTS (или новее)
- **CPU:** 1 Core
- **RAM:** 1 GB (минимум 512MB + Swap)
- **SSD:** 10 GB
- **Сеть:** Публичный IPv4 адрес

## 2. Установка Node.js
Рекомендуется использовать `nvm` для управления версиями Node.js.

```bash
# Установка nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc

# Установка Node.js 20
nvm install 20
nvm use 20
node -v # Должно быть v20.x.x
```

## 3. Установка PM2
PM2 — это менеджер процессов, который будет перезапускать бота при сбоях или перезагрузке сервера.

```bash
npm install -g pm2
```

## 4. Настройка Firewall (UFW)
Разрешите только необходимые порты:

```bash
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

## 5. Nginx и SSL (для Webhooks)
Если вы планируете использовать вебхуки вместо Long Polling:

### Установка Nginx
```bash
sudo apt update
sudo apt install nginx
```

### Настройка SSL через Certbot
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```

## 6. Настройка бота
1. Клонируйте репозиторий.
2. Установите зависимости: `npm install`.
3. Соберите проект: `npm run build`.
4. Создайте `.env` файл (см. раздел 8).

## 7. Инициализация БД
База данных SQLite создастся автоматически при первом запуске, если указан путь в `.env`.

## 8. Переменные окружения (.env)
Создайте файл `.env` в корне проекта:

```env
BOT_TOKEN=ваш_токен_от_botfather
ADMIN_TELEGRAM_ID=ваш_id
ENCRYPTION_KEY=ваш_ключ_32_символа
DATABASE_PATH=vpn-bot.db
NODE_ENV=production
```

## 9. Запуск
```bash
# Запуск через PM2
pm2 start dist/index.js --name vpn-bot

# Настройка автозапуска PM2 при ребуте
pm2 startup
pm2 save
```

## 10. Альтернатива: Systemd
Если вы не хотите использовать PM2, создайте сервис:
`/etc/systemd/system/vpn-bot.service`

```ini
[Unit]
Description=VPN Telegram Bot
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/path/to/bot
ExecStart=/usr/bin/node dist/index.js
Restart=always

[Install]
WantedBy=multi-user.target
```

---

## Частые проблемы и их решение

### ❌ Бот не отвечает
- Проверьте статус процесса: `pm2 status` или `systemctl status vpn-bot`.
- Проверьте логи: `pm2 logs vpn-bot`.
- Убедитесь, что `BOT_TOKEN` в `.env` указан верно.

### ❌ Ошибка подключения к VPS (SSH)
- Проверьте, разрешен ли порт SSH на целевом VPS.
- Убедитесь, что данные (IP, Port, Login, Pass) в базе верны (используйте `/debug`).
- Проверьте логи SSH: `logs/ssh.log`.

### ❌ Проблемы с шифрованием
- Если вы изменили `ENCRYPTION_KEY`, старые пароли в БД не смогут быть расшифрованы. Вам придется передобавить сервера.

### ❌ Wireguard команды не работают
- Убедитесь, что на целевом VPS установлен WireGuard.
- Проверьте наличие скрипта `manager-tg-bot.sh` в `/root/wireguard-manager/`.
- Используйте скрипт `scripts/test-ssh.ts` для ручной проверки выполнения команд.
