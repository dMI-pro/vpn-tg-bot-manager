import winston from 'winston';
import path from 'path';

const logDir = 'logs';

// Настройка форматов
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

const logger = winston.createLogger({
  level: 'info',
  format: logFormat,
  transports: [
    new winston.transports.File({ filename: path.join(logDir, 'error.log'), level: 'error' }),
    new winston.transports.File({ filename: path.join(logDir, 'combined.log') }),
    new winston.transports.File({ filename: path.join(logDir, 'commands.log'), level: 'info' }),
    new winston.transports.File({ filename: path.join(logDir, 'ssh.log'), level: 'debug' }),
  ],
});

// Добавляем консоль для разработки
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.printf(({ timestamp, level, message, ...meta }) => {
        return `${timestamp} [${level}]: ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
      })
    ),
  }));
}

/**
 * Расширенный логгер с методами для конкретных типов событий
 */
export const extendedLogger = {
  ...logger,

  /**
   * Логирование команд пользователя
   */
  logCommand(userId: number, command: string, result: 'success' | 'error' | 'cancel', meta?: any) {
    logger.info(`Command: ${command}`, {
      type: 'user_command',
      userId,
      command,
      result,
      ...meta
    });
  },

  /**
   * Логирование ошибок с контекстом
   */
  logError(error: any, context: string, meta?: any) {
    logger.error(`Error in ${context}: ${error.message || error}`, {
      type: 'system_error',
      context,
      stack: error.stack,
      ...meta
    });
  },

  /**
   * Логирование SSH операций
   */
  logSSH(vpsId: number, command: string, duration: number, success: boolean, error?: string) {
    logger.debug(`SSH: ${command}`, {
      type: 'ssh_operation',
      vpsId,
      command,
      duration,
      success,
      error
    });
  }
};

export default extendedLogger;
