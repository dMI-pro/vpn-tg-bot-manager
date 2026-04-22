import { Scenes, Markup, Telegraf } from 'telegraf';
import { MyContext } from '../types/context.js';
import dbManager from '../database/db.js';
import sshManager from '../ssh/ssh-manager.js';
import { encrypt, decrypt } from '../utils/encryption.js';
import { generatePrivateKey, getPublicKey, generateConfigContent } from '../utils/wg-utils.js';
import logger from '../utils/logger.js';
import QRCode from 'qrcode';

export const CREATE_CONFIG_SCENE_ID = 'CREATE_CONFIG_SCENE';

/**
 * Сцена создания нового VPN конфига
 */
export const createConfigScene = new Scenes.WizardScene<MyContext>(
  CREATE_CONFIG_SCENE_ID,
  // Step 1: Choose VPS
  async (ctx) => {
    const telegramId = ctx.from!.id;
    const vpss = await dbManager.getUserVPSS(telegramId);

    if (vpss.length === 0) {
      await ctx.reply('У вас нет добавленных серверов. Сначала добавьте VPS через /add_vps');
      return ctx.scene.leave();
    }

    const buttons = vpss.map(vps => [
      Markup.button.callback(`${vps.status === 'online' ? '🟢' : '🔴'} ${vps.name} (${vps.host})`, `select_vps:${vps.id}`)
    ]);

    await ctx.reply('Выберите VPS для создания конфигурации:', Markup.inlineKeyboard(buttons));
    return ctx.wizard.next();
  },
  // Step 2: Device Name
  async (ctx) => {
    if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) {
      return; // Wait for callback
    }

    const vpsId = parseInt(ctx.callbackQuery.data.split(':')[1]);
    ctx.scene.session.configData = { vpsId };
    
    await ctx.answerCbQuery();
    await ctx.editMessageText('Введите имя устройства (только латиница, цифры, дефис, макс 20 символов):');
    return ctx.wizard.next();
  },
  // Step 3: Validation & Creation
  async (ctx) => {
    const deviceName = (ctx.message as any)?.text;
    const nameRegex = /^[a-zA-Z0-9_-]+$/;

    if (!deviceName || !nameRegex.test(deviceName) || deviceName.length > 20) {
      await ctx.reply('Некорректное имя. Используйте только латиницу, цифры, дефис и подчеркивание (макс 20 символов):');
      return;
    }

    const { vpsId } = ctx.scene.session.configData!;
    const telegramId = ctx.from!.id;

    // Проверка на уникальность имени для этого VPS
    const existingConfigs = await dbManager.getUserConfigs(telegramId);
    const isDuplicate = existingConfigs.some(c => c.vps_id === vpsId && c.config_name === deviceName);

    if (isDuplicate) {
      await ctx.reply('Конфигурация с таким именем уже существует на этом сервере. Выберите другое имя:');
      return;
    }

    ctx.scene.session.configData!.deviceName = deviceName;

    await ctx.reply('⌛ Генерирую конфигурацию...');

    try {
      // 1. Генерируем ключи
      const privKey = generatePrivateKey();
      const pubKey = getPublicKey(privKey);

      // 2. Получаем свободный IP через SSH
      const checkIpResult = await sshManager.executeCommand(vpsId!, 'check_ip');
      if (!checkIpResult.success || !checkIpResult.output) {
        throw new Error('Failed to get free IP from server');
      }
      
      const ipData = JSON.parse(checkIpResult.output);
      const nextIp = ipData.next_ip;

      // 3. Создаем конфиг на сервере через SSH
      const createResult = await sshManager.executeScript(vpsId!, 'create', [deviceName, privKey, pubKey, nextIp]);
      if (!createResult.success) {
        throw new Error(`Server failed to create config: ${createResult.error}`);
      }

      // 4. Сохраняем в БД
      const encryptedPrivKey = encrypt(privKey);
      await dbManager.addConfig(vpsId!, telegramId, {
        config_name: deviceName,
        client_private_key: encryptedPrivKey,
        client_public_key: pubKey,
        assigned_ip: nextIp
      });

      // 5. Формируем локальный .conf файл для отправки
      const vps = await dbManager.getVPS(vpsId!);
      const wgStatus = await sshManager.getWireguardStatus(vpsId!); // Чтобы получить публичный ключ сервера и порт
      
      const configContent = generateConfigContent({
        privateKey: privKey,
        address: nextIp,
        serverPublicKey: wgStatus.public_key || '', // Мы должны убедиться что getWireguardStatus возвращает это
        endpoint: `${vps.host}:51820` // Порт можно тоже брать из статуса
      });

      // 6. Генерируем QR код
      const qrBuffer = await QRCode.toBuffer(configContent);

      // 7. Отправляем пользователю
      await ctx.replyWithDocument({
        source: Buffer.from(configContent),
        filename: `${deviceName}.conf`
      }, { caption: `✅ Конфигурация для "${deviceName}" создана!` });

      await ctx.replyWithPhoto({ source: qrBuffer }, { caption: 'QR-код для мобильного приложения WireGuard' });

      return ctx.scene.leave();

    } catch (error: any) {
      logger.error('Error in createConfigScene', error);
      await ctx.reply(`❌ Ошибка при создании конфигурации: ${error.message}`);
      return ctx.scene.leave();
    }
  }
);

// --- Command Handlers ---

export function setupWireguardCommands(bot: Telegraf<MyContext>) {
  // /create_config
  bot.command('create_config', (ctx) => ctx.scene.enter(CREATE_CONFIG_SCENE_ID));

  // /my_configs
  bot.command('my_configs', async (ctx) => {
    const telegramId = ctx.from.id;
    const configs = await dbManager.getUserConfigs(telegramId);
    const vpss = await dbManager.getUserVPSS(telegramId);

    if (configs.length === 0) {
      return ctx.reply('У вас пока нет созданных конфигураций. Используйте /create_config');
    }

    for (const vps of vpss) {
      const vpsConfigs = configs.filter(c => c.vps_id === vps.id);
      if (vpsConfigs.length === 0) continue;

      let message = `🖥 *Сервер:* ${vps.name} (${vps.host})\n\n`;

      for (const config of vpsConfigs) {
        message += `🔹 *${config.config_name}*\n`;
        message += `📍 IP: ${config.assigned_ip}\n`;
        message += `📅 Создан: ${config.created_at}\n\n`;

        const keyboard = Markup.inlineKeyboard([
          [
            Markup.button.callback('📥 Скачать', `config_get:${config.id}`),
            Markup.button.callback('🗑 Удалить', `config_delete_confirm:${config.id}`)
          ]
        ]);

        await ctx.replyWithMarkdown(message, keyboard);
        message = ''; // Reset for next config
      }
    }
  });

  // Action: Download Config
  bot.action(/^config_get:(\d+)$/, async (ctx) => {
    const configId = parseInt(ctx.match[1]);
    const telegramId = ctx.from!.id;
    await sendConfig(ctx, configId, telegramId, true);
    await ctx.answerCbQuery();
  });

  // Action: Resend Config (from commands)
  bot.command('resend_config', async (ctx) => {
    const text = ctx.message.text.split(' ');
    if (text.length < 2) return ctx.reply('Использование: /resend_config <config_id>');
    const configId = parseInt(text[1]);
    await sendConfig(ctx, configId, ctx.from.id, false);
  });

  // Action: Delete Confirm
  bot.action(/^config_delete_confirm:(\d+)$/, async (ctx) => {
    const configId = ctx.match[1];
    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Да, удалить', `config_delete_yes:${configId}`),
        Markup.button.callback('❌ Отмена', `config_delete_no:${configId}`)
      ]
    ]);
    await ctx.reply('Вы уверены, что хотите удалить эту конфигурацию?', keyboard);
    await ctx.answerCbQuery();
  });

  // Action: Delete Yes
  bot.action(/^config_delete_yes:(\d+)$/, async (ctx) => {
    const configId = parseInt(ctx.match[1]);
    const telegramId = ctx.from!.id;

    try {
      const config = await dbManager.getConfigById(configId, telegramId);
      if (!config) throw new Error('Config not found');

      await ctx.answerCbQuery('Удаляю с сервера...');
      
      // Удаляем на сервере через SSH
      await sshManager.executeScript(config.vps_id, 'delete', [config.config_name]);
      
      // Удаляем из БД
      await dbManager.deleteConfig(configId, telegramId);
      
      await ctx.editMessageText(`✅ Конфигурация "${config.config_name}" удалена.`);
    } catch (e: any) {
      logger.error('Error deleting config', e);
      await ctx.reply(`❌ Ошибка при удалении: ${e.message}`);
    }
  });

  // Action: Delete No
  bot.action(/^config_delete_no:(\d+)$/, async (ctx) => {
    await ctx.editMessageText('Отменено.');
    await ctx.answerCbQuery();
  });
}

/**
 * Вспомогательная функция для отправки конфига
 */
async function sendConfig(ctx: any, configId: number, telegramId: number, updateLastDownloaded: boolean) {
  try {
    const config = await dbManager.getConfigById(configId, telegramId);
    if (!config) return ctx.reply('Конфигурация не найдена.');

    const vps = await dbManager.getVPS(config.vps_id);
    const wgStatus = await sshManager.getWireguardStatus(config.vps_id);
    const privKey = decrypt(config.client_private_key);

    const configContent = generateConfigContent({
      privateKey: privKey,
      address: config.assigned_ip,
      serverPublicKey: wgStatus.public_key || '',
      endpoint: `${vps.host}:51820`
    });

    const qrBuffer = await QRCode.toBuffer(configContent);

    await ctx.replyWithDocument({
      source: Buffer.from(configContent),
      filename: `${config.config_name}.conf`
    });

    await ctx.replyWithPhoto({ source: qrBuffer });

    if (updateLastDownloaded) {
      // Можно добавить обновление даты в БД если нужно, 
      // хотя в текущем dbManager нет метода updateConfig
    }
  } catch (e: any) {
    logger.error('Error sending config', e);
    await ctx.reply(`❌ Ошибка: ${e.message}`);
  }
}
