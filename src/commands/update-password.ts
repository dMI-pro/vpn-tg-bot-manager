import { Scenes, Markup } from 'telegraf';
import { MyContext } from '../types/context.js';
import dbManager from '../database/db.js';
import sshManager from '../ssh/ssh-manager.js';
import { encrypt } from '../utils/encryption.js';
import logger from '../utils/logger.js';
import { Client } from 'ssh2';

/**
 * Сцена обновления пароля VPS
 */
export const updateVpsPasswordScene = new Scenes.WizardScene<MyContext>(
  'update_vps_password',
  // Шаг 1: Выбор VPS
  async (ctx) => {
    const telegramId = ctx.from!.id;
    const vpss = await dbManager.getUserVPSS(telegramId);

    if (vpss.length === 0) {
      await ctx.reply('У вас пока нет добавленных серверов.');
      return ctx.scene.leave();
    }

    // Формируем кнопки, помечаем те, что с ошибкой авторизации
    const buttons = vpss.map((vps) => {
      const label = `${vps.status === 'auth_error' ? '❌ ' : ''}${vps.name} (${vps.host})`;
      return [Markup.button.callback(label, `update_pwd_${vps.id}`)];
    });

    await ctx.reply(
      'Выберите сервер для обновления пароля:',
      Markup.inlineKeyboard(buttons)
    );
    return ctx.wizard.next();
  },
  // Шаг 2: Ожидание выбора (callback query) и запрос пароля
  async (ctx) => {
    if (ctx.callbackQuery && 'data' in ctx.callbackQuery) {
      const data = ctx.callbackQuery.data;
      if (data.startsWith('update_pwd_')) {
        const vpsId = parseInt(data.replace('update_pwd_', ''));
        const telegramId = ctx.from!.id;
        
        const vps = await dbManager.getVPSById(vpsId, telegramId);
        if (!vps) {
          await ctx.answerCbQuery('Сервер не найден или не принадлежит вам.');
          return ctx.scene.reenter();
        }

        ctx.scene.session.vpsId = vpsId;
        ctx.scene.session.vpsData = { 
          host: vps.host, 
          port: vps.port, 
          username: vps.username 
        };

        await ctx.answerCbQuery();
        await ctx.reply(`Введите новый пароль для сервера ${vps.name}: (сообщение будет удалено для безопасности)`);
        return ctx.wizard.next();
      }
    }
    await ctx.reply('Пожалуйста, выберите сервер из списка выше.');
  },
  // Шаг 3: Проверка пароля и сохранение
  async (ctx) => {
    const password = (ctx.message as any)?.text;
    if (!password) {
      await ctx.reply('Пожалуйста, введите пароль текстом.');
      return;
    }

    // Удаляем сообщение с паролем
    try {
      await ctx.deleteMessage();
    } catch (e) {
      logger.warn('Could not delete password message');
    }

    const vpsId = ctx.scene.session.vpsId!;
    const vpsData = ctx.scene.session.vpsData!;
    const telegramId = ctx.from!.id;

    await ctx.reply('⌛ Проверка нового пароля...');

    // Пробуем подключиться с новым паролем напрямую через ssh2 (без пула, т.к. там старый пароль)
    const testConn = new Client();
    try {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Connection timeout')), 10000);
        testConn
          .on('ready', () => {
            clearTimeout(timeout);
            resolve(true);
          })
          .on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
          })
          .connect({
            host: vpsData.host,
            port: vpsData.port,
            username: vpsData.username,
            password: password,
            readyTimeout: 10000
          });
      });

      testConn.end();

      // Если успех - шифруем и сохраняем
      const encrypted = encrypt(password);
      await dbManager.updateVPSPassword(vpsId, telegramId, encrypted);
      await dbManager.updateVPSStatus(vpsId, 'online', true);

      logger.info(`User ${telegramId} updated password for VPS ${vpsId}`);
      await ctx.reply('✅ Пароль успешно обновлен и проверен! Статус сервера изменен на Online.');
      return ctx.scene.leave();

    } catch (error: any) {
      testConn.end();
      logger.error(`Failed to update password for VPS ${vpsId}: ${error.message}`);
      await ctx.reply(`❌ Не удалось подключиться с новым паролем: ${error.message}\nПароль НЕ был сохранен.`);
      return ctx.scene.leave();
    }
  }
);
