# Build stage
FROM node:20-slim AS builder

# Устанавливаем зависимости для компиляции native модулей (better-sqlite3)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Production stage
FROM node:20-slim

WORKDIR /app

# Устанавливаем только runtime зависимости
COPY package*.json ./
RUN npm install --omit=dev

# Копируем скомпилированный код из builder
COPY --from=builder /app/dist ./dist

# Создаем директории для данных
RUN mkdir -p /app/data /app/logs

# Указываем переменные окружения по умолчанию
ENV DATABASE_PATH=/app/data/vpn-bot.db
ENV NODE_ENV=production

# Тома для сохранения данных
VOLUME ["/app/data", "/app/logs"]

CMD ["npm", "start"]
