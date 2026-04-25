import { Database } from 'better-sqlite3';

export function createTables(db: Database): void {
  // Таблица пользователей
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      telegram_id INTEGER PRIMARY KEY,
      username TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Таблица VPS серверов
  db.exec(`
    CREATE TABLE IF NOT EXISTS vps_servers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_telegram_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER DEFAULT 22,
      username TEXT NOT NULL,
      encrypted_password TEXT,
      status TEXT DEFAULT 'unknown',
      fail_count INTEGER DEFAULT 0,
      last_check DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_telegram_id) REFERENCES users(telegram_id) ON DELETE CASCADE
    )
  `);

  // Таблица конфигураций WireGuard
  db.exec(`
    CREATE TABLE IF NOT EXISTS wireguard_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vps_id INTEGER NOT NULL,
      owner_telegram_id INTEGER NOT NULL,
      config_name TEXT NOT NULL,
      client_private_key TEXT NOT NULL,
      client_public_key TEXT NOT NULL,
      assigned_ip TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_downloaded_at DATETIME,
      FOREIGN KEY (vps_id) REFERENCES vps_servers(id) ON DELETE CASCADE,
      FOREIGN KEY (owner_telegram_id) REFERENCES users(telegram_id) ON DELETE CASCADE
    )
  `);
}
