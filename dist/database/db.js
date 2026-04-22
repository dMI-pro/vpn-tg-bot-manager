import sqlite3 from 'sqlite3';
import dotenv from 'dotenv';
import logger from '../utils/logger.js';
dotenv.config();
const dbPath = process.env.DATABASE_PATH || './vpn-bot.db';
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        logger.error('Could not connect to database', err);
    }
    else {
        logger.info('Connected to database');
    }
});
export const run = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.run(sql, params, (err) => {
            if (err) {
                logger.error(`Error running sql: ${sql}`, err);
                reject(err);
            }
            else {
                resolve();
            }
        });
    });
};
export const get = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) {
                logger.error(`Error getting sql: ${sql}`, err);
                reject(err);
            }
            else {
                resolve(row);
            }
        });
    });
};
export const all = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) {
                logger.error(`Error all sql: ${sql}`, err);
                reject(err);
            }
            else {
                resolve(rows);
            }
        });
    });
};
export const initDb = async () => {
    await run(`
    CREATE TABLE IF NOT EXISTS servers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER DEFAULT 22,
      username TEXT NOT NULL,
      password TEXT,
      private_key TEXT
    )
  `);
    await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER UNIQUE NOT NULL,
      username TEXT,
      is_admin INTEGER DEFAULT 0
    )
  `);
    logger.info('Database tables initialized');
};
export default db;
