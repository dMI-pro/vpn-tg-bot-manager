import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
import { initDb } from './database/db.js';
import logger from './utils/logger.js';
import { setupStartCommand } from './commands/start.js';
dotenv.config();
const token = process.env.BOT_TOKEN;
if (!token) {
    logger.error('BOT_TOKEN is not defined in .env');
    process.exit(1);
}
const bot = new Telegraf(token);
// Initialize Database
await initDb();
// Setup Commands
setupStartCommand(bot);
// Error Handling
bot.catch((err, ctx) => {
    logger.error(`Telegraf error for update ${ctx.update.update_id}`, err);
});
// Start Bot
bot.launch(() => {
    logger.info('Bot is running...');
});
// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
