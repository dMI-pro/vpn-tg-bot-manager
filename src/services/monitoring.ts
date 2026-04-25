import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { Telegraf } from 'telegraf';
import { MyContext } from '../types/context.js';
import dbManager from '../database/db.js';
import sshManager from '../ssh/ssh-manager.js';
import logger from '../utils/logger.js';

export class MonitoringService {
  private bot: Telegraf<MyContext>;
  private readonly DB_PATH = 'vpn-bot.db';
  private readonly BACKUP_DIR = 'backups';

  constructor(bot: Telegraf<MyContext>) {
    this.bot = bot;
    
    // Ensure backup directory exists
    if (!fs.existsSync(this.BACKUP_DIR)) {
      fs.mkdirSync(this.BACKUP_DIR);
    }
  }

  /**
   * Запуск всех фоновых задач
   */
  public start(): void {
    // Каждые 30 минут - проверка VPS
    cron.schedule('*/30 * * * *', () => this.checkAllVPS());

    // Раз в день в 03:00 - бэкап БД
    cron.schedule('0 3 * * *', () => this.backupDatabase());

    logger.info('[Monitoring] Background tasks started');
  }

  /**
   * Проверка всех серверов в системе
   */
  public async checkAllVPS(): Promise<void> {
    logger.info('[Monitoring] Starting scheduled VPS check...');
    try {
      const vpss = await dbManager.getAllVPSS();
      
      for (const vps of vpss) {
        try {
          await this.checkSingleVPS(vps);
        } catch (error) {
          logger.error(`[Monitoring] Error checking VPS ${vps.id}:`, error);
        }
      }
    } catch (error) {
      logger.error('[Monitoring] Failed to get VPS list for check:', error);
    }
  }

  /**
   * Проверка одного сервера
   */
  public async checkSingleVPS(vps: any): Promise<void> {
    try {
      const result = await sshManager.getWireguardStatus(vps.id);
      const oldStatus = vps.status;
      const oldFailCount = vps.fail_count || 0;

      if (result.running) {
        // Сервер онлайн и WG работает
        await dbManager.updateVPSStatus(vps.id, 'online', true);
        
        if (oldStatus !== 'online') {
          await this.notifyOwner(vps.user_telegram_id, `✅ Ваш сервер *${vps.name}* снова в сети и WireGuard активен!`);
        }
      } else {
        // Сервер доступен по SSH, но WireGuard не запущен (result.running === false)
        // Но подождите, если sshManager.getWireguardStatus вернул success: true но running: false, 
        // значит SSH работает, а WG нет.
        
        // Нам нужно знать, была ли ошибка SSH или просто WG не запущен.
        // getWireguardStatus не возвращает SSHResult напрямую.
        
        // Давайте проверим статус напрямую через executeCommand для точности в уведомлениях
        const pingResult = await sshManager.executeCommand(vps.id, 'echo 1', 5000);
        
        if (pingResult.success) {
          // SSH работает, значит проблема именно в WireGuard
          await dbManager.updateVPSStatus(vps.id, 'wg_stopped', true);
          if (oldStatus !== 'wg_stopped') {
            await this.notifyOwner(vps.user_telegram_id, `⚠️ На сервере *${vps.name}* остановлен сервис WireGuard!`);
          }
        } else {
          // Ошибка SSH (оффлайн или ошибка аут)
          const newStatus = pingResult.errorType === 'auth' ? 'auth_error' : 'offline';
          await dbManager.updateVPSStatus(vps.id, newStatus);
          
          const vpsUpdated = await dbManager.getVPS(vps.id);
          const newFailCount = vpsUpdated.fail_count;

          if (newStatus === 'auth_error' && oldStatus !== 'auth_error') {
            await this.notifyOwner(vps.user_telegram_id, `⚠️ Ошибка аутентификации на сервере *${vps.name}*. Проверьте пароль.`);
          } else if (newFailCount === 3) {
            await this.notifyOwner(vps.user_telegram_id, `🔴 Сервер *${vps.name}* недоступен (оффлайн) более 3-х проверок подряд.`);
          }
        }
      }
    } catch (error) {
      logger.error(`[Monitoring] Unexpected error checking VPS ${vps.id}:`, error);
    }
  }

  /**
   * Резервное копирование базы данных
   */
  public async backupDatabase(): Promise<void> {
    logger.info('[Monitoring] Starting database backup...');
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(this.BACKUP_DIR, `vpn-bot-backup-${timestamp}.db`);
      
      fs.copyFileSync(this.DB_PATH, backupPath);
      logger.info(`[Monitoring] Backup created: ${backupPath}`);

      // Храним только последние 7 копий
      const files = fs.readdirSync(this.BACKUP_DIR)
        .filter(f => f.startsWith('vpn-bot-backup-'))
        .map(f => ({ name: f, time: fs.statSync(path.join(this.BACKUP_DIR, f)).mtime.getTime() }))
        .sort((a, b) => b.time - a.time);

      if (files.length > 7) {
        files.slice(7).forEach(f => {
          fs.unlinkSync(path.join(this.BACKUP_DIR, f.name));
          logger.debug(`[Monitoring] Deleted old backup: ${f.name}`);
        });
      }
    } catch (error) {
      logger.error('[Monitoring] Database backup failed:', error);
    }
  }

  /**
   * Отправка уведомления владельцу
   */
  private async notifyOwner(telegramId: number, message: string): Promise<void> {
    try {
      await this.bot.telegram.sendMessage(telegramId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error(`[Monitoring] Failed to notify owner ${telegramId}:`, error);
    }
  }
}
