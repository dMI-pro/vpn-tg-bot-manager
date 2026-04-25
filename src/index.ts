import { Telegraf, session, Scenes } from 'telegraf';
import dotenv from 'dotenv';
import logger from './utils/logger.js';
import { MyContext } from './types/context.js';
import { setupVPSCommands, addVpsScene, updateVpsPasswordScene } from './commands/vps-commands.js';
import { setupWireguardCommands, createConfigScene } from './commands/wireguard-commands.js';
import dbManager from './database/db.js';
import { MonitoringService } from './services/monitoring.js';

dotenv.config();

const token = process.env.BOT_TOKEN;

if (!token) {
  logger.error('BOT_TOKEN is not defined in .env');
  process.exit(1);
}

const bot = new Telegraf<MyContext>(token);

// --- Middleware ---

// 1. Session Middleware
bot.use(session());

// 2. Logging Middleware
bot.use(async (ctx, next) => {
  const start = Date.now();
  const userId = ctx.from?.id;
  const username = ctx.from?.username || 'unknown';
  const text = ctx.message && 'text' in ctx.message ? ctx.message.text : 'non-text update';

  if (userId) {
    // Add user to DB if not exists
    await dbManager.addUser(userId, username);
  }

  await next();

  const ms = Date.now() - start;
  if (text !== 'non-text update') {
    logger.info(`[User ${userId} (@${username})] Action: ${text} (${ms}ms)`);
  }
});

// 3. Ban Check Middleware
bot.use(async (ctx, next) => {
  const userId = ctx.from?.id;
  if (!userId) return next();

  const isBanned = await dbManager.isBanned(userId);
  if (isBanned) {
    return ctx.reply('Вы были заблокированы за подозрительную активность.');
  }
  return next();
});

// 4. Rate Limiting Middleware (5 commands per minute)
const rateLimitMap = new Map<number, number[]>();
bot.use(async (ctx, next) => {
  const userId = ctx.from?.id;
  if (!userId) return next();

  const now = Date.now();
  const userRequests = rateLimitMap.get(userId) || [];
  
  // Clean up old requests
  const recentRequests = userRequests.filter(time => now - time < 60000);
  
  if (recentRequests.length >= 5) {
    logger.warn(`Rate limit exceeded for user ${userId}`);
    return ctx.reply('Слишком много запросов. Пожалуйста, подождите минуту.');
  }
  
  recentRequests.push(now);
  rateLimitMap.set(userId, recentRequests);
  return next();
});

// --- Scenes & Commands ---

const stage = new Scenes.Stage<MyContext>([addVpsScene, updateVpsPasswordScene, createConfigScene]);
bot.use(stage.middleware());

// Setup Commands
setupVPSCommands(bot);
setupWireguardCommands(bot);

// --- Background Tasks ---

const monitoring = new MonitoringService(bot);
monitoring.start();
logger.info('Monitoring service started');

// --- Error Handling ---

const errorSpamMap = new Map<number, { count: number, lastError: number }>();

bot.catch(async (err: any, ctx: MyContext) => {
  const userId = ctx.from?.id;
  logger.error(`Telegraf error for user ${userId || 'unknown'}:`, err);

  if (userId) {
    const now = Date.now();
    const spam = errorSpamMap.get(userId) || { count: 0, lastError: 0 };
    
    // Reset count if last error was more than 10 minutes ago
    if (now - spam.lastError > 600000) {
      spam.count = 0;
    }
    
    spam.count++;
    spam.lastError = now;
    errorSpamMap.set(userId, spam);

    // Ban if more than 10 errors in 10 minutes
    if (spam.count > 10) {
      await dbManager.banUser(userId);
      logger.warn(`User ${userId} banned for error spamming`);
      await ctx.reply('Вы были автоматически заблокированы из-за большого количества ошибок. Обратитесь к администратору.');
      return;
    }
  }

  try {
    await ctx.reply('⚠️ Произошла ошибка при выполнении команды. Пожалуйста, попробуйте позже.');
  } catch (replyErr) {
    logger.error('Failed to send error message to user:', replyErr);
  }
});

// --- Launch & Graceful Shutdown ---

bot.launch(() => {
  logger.info('Bot is running...');
}).catch(err => {
  logger.error('Failed to launch bot:', err);
  process.exit(1);
});

const shutdown = async (signal: string) => {
  logger.info(`Received ${signal}. Shutting down...`);
  bot.stop(signal);
  // Give it a moment to finish current requests
  setTimeout(() => {
    process.exit(0);
  }, 1000);
};

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
