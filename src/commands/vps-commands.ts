import { Scenes, Markup, Telegraf } from 'telegraf';
import { MyContext } from '../types/context.js';
import dbManager from '../database/db.js';
import sshManager from '../ssh/ssh-manager.js';
import { encrypt } from '../utils/encryption.js';
import logger from '../utils/logger.js';

// --- /add_vps Wizard Scene ---

export const ADD_VPS_SCENE_ID = 'ADD_VPS_SCENE';

export const addVpsScene = new Scenes.WizardScene<MyContext>(
  ADD_VPS_SCENE_ID,
  // Step 1: Name
  async (ctx) => {
    ctx.scene.session.vpsData = {};
    await ctx.reply('Введите название для вашего VPS (например, "Мой домашний сервер"):');
    return ctx.wizard.next();
  },
  // Step 2: Host
  async (ctx) => {
    const text = (ctx.message as any)?.text;
    if (!text || text.length < 3) {
      await ctx.reply('Пожалуйста, введите корректное название (минимум 3 символа):');
      return;
    }
    ctx.scene.session.vpsData!.name = text;
    await ctx.reply('Введите IP адрес или домен сервера:');
    return ctx.wizard.next();
  },
  // Step 3: Port
  async (ctx) => {
    const text = (ctx.message as any)?.text;
    if (!text) {
      await ctx.reply('Пожалуйста, введите корректный IP или домен:');
      return;
    }
    ctx.scene.session.vpsData!.host = text;
    await ctx.reply('Введите SSH порт (по умолчанию 22):', Markup.keyboard(['22']).oneTime().resize());
    return ctx.wizard.next();
  },
  // Step 4: Username
  async (ctx) => {
    const text = (ctx.message as any)?.text;
    const port = parseInt(text);
    if (isNaN(port)) {
      await ctx.reply('Пожалуйста, введите числовой порт:');
      return;
    }
    ctx.scene.session.vpsData!.port = port;
    await ctx.reply('Введите имя пользователя SSH (по умолчанию root):', Markup.keyboard(['root']).oneTime().resize());
    return ctx.wizard.next();
  },
  // Step 5: Password
  async (ctx) => {
    const text = (ctx.message as any)?.text;
    if (!text) {
      await ctx.reply('Пожалуйста, введите имя пользователя:');
      return;
    }
    ctx.scene.session.vpsData!.username = text;
    await ctx.reply('Введите SSH пароль (сообщение будет удалено для безопасности):', Markup.removeKeyboard());
    return ctx.wizard.next();
  },
  // Step 6: Finalize & Test
  async (ctx) => {
    const text = (ctx.message as any)?.text;
    if (!text) {
      await ctx.reply('Пожалуйста, введите пароль:');
      return;
    }
    
    // Удаляем сообщение с паролем для безопасности
    try {
      await ctx.deleteMessage();
    } catch (e) {
      logger.warn('Could not delete password message', e);
    }

    ctx.scene.session.vpsData!.password = text;
    const vpsData = ctx.scene.session.vpsData!;
    const telegramId = ctx.from!.id;

    await ctx.reply('⌛ Проверяю подключение к серверу...');

    try {
      // 1. Сначала добавляем пользователя в БД (если нет)
      await dbManager.addUser(telegramId, ctx.from?.username);

      // 2. Шифруем пароль
      const encryptedPassword = encrypt(vpsData.password!);

      // 3. Создаем временную запись для теста
      const tempId = await dbManager.addVPS(telegramId, {
        name: vpsData.name,
        host: vpsData.host,
        port: vpsData.port,
        username: vpsData.username,
        encrypted_password: encryptedPassword
      });

      // 4. Тестируем соединение
      const testResult = await sshManager.testConnection(tempId);

      if (testResult.success) {
        await ctx.reply(`✅ VPS "${vpsData.name}" успешно добавлен и проверен!`);
        return ctx.scene.leave();
      } else {
        // Удаляем если тест не прошел
        await dbManager.deleteVPS(tempId, telegramId);
        await ctx.reply(`❌ Ошибка подключения: ${testResult.error || 'Неизвестная ошибка'}\n\nПопробуйте /add_vps снова.`);
        return ctx.scene.leave();
      }
    } catch (error: any) {
      logger.error('Error adding VPS in scene', error);
      await ctx.reply(`❌ Ошибка: ${error.message}\n\nПопробуйте /add_vps снова.`);
      return ctx.scene.leave();
    }
  }
);

// --- Command Handlers ---

export function setupVPSCommands(bot: Telegraf<MyContext>) {
  // /start
  bot.start(async (ctx) => {
    const telegramId = ctx.from.id;
    const username = ctx.from.username;

    try {
      await dbManager.addUser(telegramId, username);
    } catch (error) {
      logger.error('Error registering user on /start', error);
    }

    const welcome = `
👋 Привет, ${username || 'пользователь'}! Я бот для управления твоими VPN серверами.

*Доступные команды:*
/add_vps - Добавить новый сервер
/my_vpss - Список твоих серверов
/create_config - Создать новый VPN конфиг
/my_configs - Мои VPN конфигурации
/help - Показать это сообщение
    `;
    await ctx.replyWithMarkdown(welcome);
  });

  // /help
  bot.help(async (ctx) => {
    const helpText = `
*Доступные команды:*
/add_vps - Добавить новый сервер
/my_vpss - Список твоих серверов
/create_config - Создать новый VPN конфиг
/my_configs - Мои VPN конфигурации
/vps_status <id> - Статус сервера
/remove_vps <id> - Удалить сервер
    `;
    await ctx.replyWithMarkdown(helpText);
  });

  // /my_vpss
  bot.command('my_vpss', async (ctx) => {
    const telegramId = ctx.from.id;
    const vpss = await dbManager.getUserVPSS(telegramId);

    if (vpss.length === 0) {
      return ctx.reply('У вас пока нет добавленных серверов. Используйте /add_vps');
    }

    for (const vps of vpss) {
      const statusIcon = vps.status === 'online' ? '🟢' : vps.status === 'auth_error' ? '⚠️' : '🔴';
      const statusText = vps.status === 'online' ? 'Онлайн' : vps.status === 'auth_error' ? 'Ошибка аут.' : 'Офлайн';
      
      const message = `
📡 *Название:* ${vps.name}
🌐 *IP:* ${vps.host}
📊 *Статус:* ${statusIcon} ${statusText}
📅 *Добавлен:* ${vps.created_at}
      `;

      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback('🔍 Статус', `vps_status:${vps.id}`),
          Markup.button.callback('🗑️ Удалить', `vps_remove_confirm:${vps.id}`)
        ]
      ]);

      await ctx.replyWithMarkdown(message, keyboard);
    }
  });

  // Handle Action: Status
  bot.action(/^vps_status:(\d+)$/, async (ctx) => {
    const vpsId = parseInt(ctx.match[1]);
    const telegramId = ctx.from!.id;

    await ctx.answerCbQuery('Запрашиваю статус...');
    
    const vps = await dbManager.getVPSById(vpsId, telegramId);
    if (!vps) return ctx.reply('Сервер не найден.');

    const wgStatus = await sshManager.getWireguardStatus(vpsId);
    
    const message = `
📊 *Детальный статус: ${vps.name}*

🛡️ *Wireguard:* ${wgStatus.running ? '✅ Активен' : '❌ Выключен'}
👥 *Активных пиров:* ${wgStatus.peers}
📉 *Трафик:* ${wgStatus.transfer}
🕒 *Последняя проверка:* ${vps.last_check || 'Не проводилась'}
    `;

    await ctx.replyWithMarkdown(message);
  });

  // Handle Action: Remove Confirmation
  bot.action(/^vps_remove_confirm:(\d+)$/, async (ctx) => {
    const vpsId = ctx.match[1];
    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Да, удалить', `vps_remove_yes:${vpsId}`),
        Markup.button.callback('❌ Отмена', `vps_remove_no:${vpsId}`)
      ]
    ]);
    await ctx.reply('Вы уверены, что хотите удалить этот VPS и все его конфигурации?', keyboard);
    await ctx.answerCbQuery();
  });

  // Handle Action: Remove Yes
  bot.action(/^vps_remove_yes:(\d+)$/, async (ctx) => {
    const vpsId = parseInt(ctx.match[1]);
    const telegramId = ctx.from!.id;

    try {
      await dbManager.deleteVPS(vpsId, telegramId);
      await ctx.editMessageText('✅ VPS успешно удален.');
    } catch (e: any) {
      await ctx.reply(`❌ Ошибка при удалении: ${e.message}`);
    }
    await ctx.answerCbQuery();
  });

  // Handle Action: Remove No
  bot.action(/^vps_remove_no:(\d+)$/, async (ctx) => {
    await ctx.editMessageText('Отменено.');
    await ctx.answerCbQuery();
  });

  // /vps_status <id>
  bot.command('vps_status', async (ctx) => {
    const text = ctx.message.text.split(' ');
    if (text.length < 2) return ctx.reply('Использование: /vps_status <vps_id>');
    const vpsId = parseInt(text[1]);
    const telegramId = ctx.from.id;

    const vps = await dbManager.getVPSById(vpsId, telegramId);
    if (!vps) return ctx.reply('Сервер не найден или у вас нет к нему доступа.');

    await ctx.reply('⌛ Запрашиваю статус...');
    const wgStatus = await sshManager.getWireguardStatus(vpsId);
    
    const message = `
📊 *Детальный статус: ${vps.name}*

🛡️ *Wireguard:* ${wgStatus.running ? '✅ Активен' : '❌ Выключен'}
👥 *Активных пиров:* ${wgStatus.peers}
📉 *Трафик:* ${wgStatus.transfer}
🕒 *Последняя проверка:* ${vps.last_check || 'Не проводилась'}
    `;

    await ctx.replyWithMarkdown(message);
  });

  // /remove_vps <id>
  bot.command('remove_vps', async (ctx) => {
    const text = ctx.message.text.split(' ');
    if (text.length < 2) return ctx.reply('Использование: /remove_vps <vps_id>');
    
    const vpsId = text[1];
    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Да, удалить', `vps_remove_yes:${vpsId}`),
        Markup.button.callback('❌ Отмена', `vps_remove_no:${vpsId}`)
      ]
    ]);
    await ctx.reply(`Вы уверены, что хотите удалить VPS #${vpsId} и все его конфигурации?`, keyboard);
  });

  // Entry point for scene
  bot.command('add_vps', (ctx) => ctx.scene.enter(ADD_VPS_SCENE_ID));
}
