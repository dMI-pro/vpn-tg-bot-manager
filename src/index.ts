import { Telegraf, session, Scenes } from 'telegraf';
import dotenv from 'dotenv';
import logger from './utils/logger.js';
import { MyContext } from './types/context.js';
import { setupVPSCommands, addVpsScene } from './commands/vps-commands.js';
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

// Stage setup
const stage = new Scenes.Stage<MyContext>([addVpsScene, createConfigScene]);

// Middlewares
bot.use(session());
bot.use(stage.middleware());

// Setup Commands
setupVPSCommands(bot);
setupWireguardCommands(bot);

// Start Monitoring
const monitoring = new MonitoringService(bot);
monitoring.start();

// Error Handling
bot.catch((err: any, ctx: MyContext) => {
  logger.error(`Telegraf error for update ${ctx.update.update_id}`, err);
});

// Start Bot
bot.launch(() => {
  logger.info('Bot is running...');
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
