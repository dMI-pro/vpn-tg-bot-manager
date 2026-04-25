import DatabaseConstructor, { Database } from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { createTables } from './schema.js';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class DatabaseManager {
  private db: Database;

  constructor(dbPath: string = 'vpn-bot.db') {
    try {
      this.db = new DatabaseConstructor(dbPath);
      this.db.pragma('foreign_keys = ON');
      createTables(this.db);
      logger.info('Database initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize database:', error);
      throw error;
    }
  }

  // --- User Methods ---

  async addUser(telegramId: number, username?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const stmt = this.db.prepare('INSERT OR IGNORE INTO users (telegram_id, username, is_banned) VALUES (?, ?, 0)');
        stmt.run(telegramId, username || null);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }

  async isBanned(telegramId: number): Promise<boolean> {
    return new Promise((resolve, reject) => {
      try {
        const row = this.db.prepare('SELECT is_banned FROM users WHERE telegram_id = ?').get(telegramId) as any;
        resolve(row ? row.is_banned === 1 : false);
      } catch (error) {
        reject(error);
      }
    });
  }

  async banUser(telegramId: number): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.db.prepare('UPDATE users SET is_banned = 1 WHERE telegram_id = ?').run(telegramId);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }

  // --- VPS Methods ---

  async addVPS(userTelegramId: number, vpsData: any): Promise<number> {
    return new Promise((resolve, reject) => {
      try {
        // Проверка существования пользователя
        const user = this.db.prepare('SELECT telegram_id FROM users WHERE telegram_id = ?').get(userTelegramId);
        if (!user) {
          throw new Error(`User with telegram_id ${userTelegramId} not found`);
        }

        const stmt = this.db.prepare(`
          INSERT INTO vps_servers 
          (user_telegram_id, name, host, port, username, encrypted_password) 
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        
        const result = stmt.run(
          userTelegramId,
          vpsData.name,
          vpsData.host,
          vpsData.port || 22,
          vpsData.username,
          vpsData.encrypted_password
        );
        
        resolve(result.lastInsertRowid as number);
      } catch (error) {
        reject(error);
      }
    });
  }

  async getUserVPSS(telegramId: number): Promise<any[]> {
    return new Promise((resolve, reject) => {
      try {
        const stmt = this.db.prepare('SELECT * FROM vps_servers WHERE user_telegram_id = ?');
        const rows = stmt.all(telegramId);
        resolve(rows);
      } catch (error) {
        reject(error);
      }
    });
  }

  async getVPSById(vpsId: number, userTelegramId: number): Promise<any | null> {
    return new Promise((resolve, reject) => {
      try {
        const stmt = this.db.prepare('SELECT * FROM vps_servers WHERE id = ? AND user_telegram_id = ?');
        const row = stmt.get(vpsId, userTelegramId);
        resolve(row || null);
      } catch (error) {
        reject(error);
      }
    });
  }

  async getVPS(vpsId: number): Promise<any | null> {
    return new Promise((resolve, reject) => {
      try {
        const stmt = this.db.prepare('SELECT * FROM vps_servers WHERE id = ?');
        const row = stmt.get(vpsId);
        resolve(row || null);
      } catch (error) {
        reject(error);
      }
    });
  }

  async updateVPSStatus(vpsId: number, status: string, resetFailCount: boolean = false): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const failCountUpdate = resetFailCount ? ', fail_count = 0' : ', fail_count = fail_count + 1';
        const stmt = this.db.prepare(`UPDATE vps_servers SET status = ?, last_check = CURRENT_TIMESTAMP${failCountUpdate} WHERE id = ?`);
        const result = stmt.run(status, vpsId);
        if (result.changes === 0) {
          throw new Error(`VPS with id ${vpsId} not found`);
        }
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }

  async getAllVPSS(): Promise<any[]> {
    return new Promise((resolve, reject) => {
      try {
        const stmt = this.db.prepare('SELECT * FROM vps_servers');
        const rows = stmt.all();
        resolve(rows);
      } catch (error) {
        reject(error);
      }
    });
  }

  async getStats(): Promise<any> {
    return new Promise((resolve, reject) => {
      try {
        const totalVps = this.db.prepare('SELECT COUNT(*) as count FROM vps_servers').get() as any;
        const totalConfigs = this.db.prepare('SELECT COUNT(*) as count FROM wireguard_configs').get() as any;
        const problematicVps = this.db.prepare("SELECT * FROM vps_servers WHERE status != 'online'").all();
        resolve({
          totalVps: totalVps.count,
          totalConfigs: totalConfigs.count,
          problematicVps
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async deleteVPS(vpsId: number, userTelegramId: number): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const stmt = this.db.prepare('DELETE FROM vps_servers WHERE id = ? AND user_telegram_id = ?');
        const result = stmt.run(vpsId, userTelegramId);
        if (result.changes === 0) {
          throw new Error(`VPS with id ${vpsId} not found or doesn't belong to user ${userTelegramId}`);
        }
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }

  async updateVPSPassword(vpsId: number, userTelegramId: number, encryptedPassword: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const stmt = this.db.prepare('UPDATE vps_servers SET encrypted_password = ?, status = \'unknown\', fail_count = 0 WHERE id = ? AND user_telegram_id = ?');
        const result = stmt.run(encryptedPassword, vpsId, userTelegramId);
        if (result.changes === 0) {
          throw new Error(`VPS with id ${vpsId} not found or doesn't belong to user ${userTelegramId}`);
        }
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }

  // --- WireGuard Config Methods ---

  async addConfig(vpsId: number, ownerTelegramId: number, configData: any): Promise<number> {
    return new Promise((resolve, reject) => {
      try {
        // Проверка существования VPS и прав владельца
        const vps = this.db.prepare('SELECT id FROM vps_servers WHERE id = ? AND user_telegram_id = ?').get(vpsId, ownerTelegramId);
        if (!vps) {
          throw new Error(`VPS with id ${vpsId} not found or doesn't belong to user ${ownerTelegramId}`);
        }

        const stmt = this.db.prepare(`
          INSERT INTO wireguard_configs 
          (vps_id, owner_telegram_id, config_name, client_private_key, client_public_key, assigned_ip) 
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        
        const result = stmt.run(
          vpsId,
          ownerTelegramId,
          configData.config_name,
          configData.client_private_key,
          configData.client_public_key,
          configData.assigned_ip
        );
        
        resolve(result.lastInsertRowid as number);
      } catch (error) {
        reject(error);
      }
    });
  }

  async getUserConfigs(telegramId: number): Promise<any[]> {
    return new Promise((resolve, reject) => {
      try {
        const stmt = this.db.prepare('SELECT * FROM wireguard_configs WHERE owner_telegram_id = ?');
        const rows = stmt.all(telegramId);
        resolve(rows);
      } catch (error) {
        reject(error);
      }
    });
  }

  async getConfigById(configId: number, telegramId: number): Promise<any | null> {
    return new Promise((resolve, reject) => {
      try {
        const stmt = this.db.prepare('SELECT * FROM wireguard_configs WHERE id = ? AND owner_telegram_id = ?');
        const row = stmt.get(configId, telegramId);
        resolve(row || null);
      } catch (error) {
        reject(error);
      }
    });
  }

  async deleteConfig(configId: number, telegramId: number): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const stmt = this.db.prepare('DELETE FROM wireguard_configs WHERE id = ? AND owner_telegram_id = ?');
        const result = stmt.run(configId, telegramId);
        if (result.changes === 0) {
          throw new Error(`Config with id ${configId} not found or doesn't belong to user ${telegramId}`);
        }
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }

  close(): void {
    this.db.close();
  }
}

// Экспортируем экземпляр по умолчанию
const defaultDbPath = process.env.DATABASE_PATH || 'vpn-bot.db';
const dbManager = new DatabaseManager(defaultDbPath);
export default dbManager;
