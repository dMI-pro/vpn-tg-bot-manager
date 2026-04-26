import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Скрипт для создания резервной копии базы данных SQLite.
 * Сохраняет последние 7 копий.
 */

const dbPath = process.env.DATABASE_PATH || 'vpn-bot.db';
const backupDir = 'backups';
const maxBackups = 7;

if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir);
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = path.join(backupDir, `vpn-bot-${timestamp}.db`);

try {
  console.log(`📦 Создание бэкапа базы данных ${dbPath}...`);
  
  if (!fs.existsSync(dbPath)) {
    console.error(`❌ Ошибка: Файл базы данных ${dbPath} не найден.`);
    process.exit(1);
  }

  // Копируем файл
  fs.copyFileSync(dbPath, backupPath);
  console.log(`✅ Бэкап сохранен: ${backupPath}`);

  // Удаляем старые бэкапы
  const files = fs.readdirSync(backupDir)
    .filter(f => f.startsWith('vpn-bot-') && f.endsWith('.db'))
    .map(f => ({ name: f, time: fs.statSync(path.join(backupDir, f)).mtime.getTime() }))
    .sort((a, b) => b.time - a.time);

  if (files.length > maxBackups) {
    console.log(`🧹 Удаление старых бэкапов (оставляем ${maxBackups})...`);
    for (let i = maxBackups; i < files.length; i++) {
      const oldFile = path.join(backupDir, files[i].name);
      fs.unlinkSync(oldFile);
      console.log(`🗑️ Удалено: ${oldFile}`);
    }
  }

  console.log('✅ Процесс резервного копирования завершен.');
} catch (error) {
  console.error('❌ Ошибка при создании бэкапа:', error);
  process.exit(1);
}
