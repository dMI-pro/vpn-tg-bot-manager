import { Telegraf } from 'telegraf';
import { MyContext } from '../types/context.js';
import { run, get } from '../database/db.js';
import logger from '../utils/logger.js';

export const setupStartCommand = (bot: Telegraf<MyContext>) => {
  bot.start(async (ctx) => {
    const { id, username } = ctx.from;
    
    try {
      const user = await get('SELECT * FROM users WHERE telegram_id = ?', [id]);
      
      if (!user) {
        await run('INSERT INTO users (telegram_id, username) VALUES (?, ?)', [id, username]);
        logger.info(`New user registered: ${username} (${id})`);
      }

      await ctx.reply(`Привет, ${username || 'пользователь'}! Добро пожаловать в менеджер Wireguard VPN.`);
    } catch (error) {
      logger.error('Error in start command', error);
      await ctx.reply('Произошла ошибка при регистрации. Пожалуйста, попробуйте позже.');
    }
  });
};
