import { Client } from 'ssh2';
import dbManager from '../database/db.js';
import { decrypt } from '../utils/encryption.js';
import logger from '../utils/logger.js';

// --- Types and Interfaces ---

export type AuthType = 'password' | 'ssh-key';

export interface VPSConfig {
  id: number;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  password?: string;
  privateKey?: string;
}

export interface SSHResult {
  success: boolean;
  output?: string;
  error?: string;
  errorType?: 'auth' | 'connection' | 'timeout' | 'unknown';
  duration?: number;
  authMethodUsed?: AuthType;
}

export type VPSStatus = 'online' | 'offline' | 'auth_error' | 'unknown';

export interface WireguardStatus {
  running: boolean;
  peers: number;
  transfer: string;
  public_key?: string;
  listen_port?: number;
}

export interface SSHConnectConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  readyTimeout: number;
  keepaliveInterval: number;
}

interface PoolConnection {
  client: Client;
  lastUsed: Date;
  vpsConfig: VPSConfig;
  inUse: boolean;
}

export class SSHManager {
  private connections: Map<number, PoolConnection[]> = new Map();
  private readonly MAX_CONNECTIONS_PER_VPS = 2;
  private readonly IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
  private readonly SCRIPT_PATH = '/root/wireguard-manager/manager-tg-bot.sh';

  constructor() {
    // Start cleanup interval
    setInterval(() => this.cleanupIdleConnections(), 60000);
  }

  /**
   * Формирует конфигурацию подключения для ssh2
   */
  public buildAuthConfig(vpsConfig: VPSConfig): SSHConnectConfig {
    const config: SSHConnectConfig = {
      host: vpsConfig.host,
      port: vpsConfig.port,
      username: vpsConfig.username,
      readyTimeout: 10000,
      keepaliveInterval: 30000,
    };

    let methodUsed: AuthType = vpsConfig.authType;

    if (vpsConfig.authType === 'ssh-key') {
      if (vpsConfig.privateKey) {
        config.privateKey = vpsConfig.privateKey;
      } else {
        logger.warn(`[SSH] vpsId=${vpsConfig.id} AuthType is ssh-key but no privateKey provided. Falling back to password.`);
        methodUsed = 'password';
        if (!vpsConfig.password) throw new Error('No password provided');
        config.password = vpsConfig.password;
      }
    } else {
      if (!vpsConfig.password) throw new Error('No password provided');
      config.password = vpsConfig.password;
      methodUsed = 'password';
    }

    logger.info(`[SSH] vpsId=${vpsConfig.id} Using ${methodUsed} authentication`);
    return config;
  }

  /**
   * Устанавливает новое SSH соединение
   */
  private async connect(vpsConfig: VPSConfig): Promise<Client> {
    return new Promise((resolve, reject) => {
      const client = new Client();
      const authConfig = this.buildAuthConfig(vpsConfig);

      client
        .on('ready', () => {
          logger.debug(`[SSH] vpsId=${vpsConfig.id} Connection ready`);
          resolve(client);
        })
        .on('error', (err) => {
          logger.error(`[SSH] vpsId=${vpsConfig.id} Connection error: ${err.message}`);
          reject(err);
        })
        .connect(authConfig);
    });
  }

  /**
   * Получает существующее или создает новое соединение из пула
   */
  private async getConnection(vpsId: number): Promise<PoolConnection> {
    let pool = this.connections.get(vpsId) || [];
    
    // Поиск свободного живого соединения
    for (const conn of pool) {
      if (!conn.inUse) {
        try {
          // Проверка живо ли соединение
          await this.ping(conn.client);
          conn.inUse = true;
          conn.lastUsed = new Date();
          return conn;
        } catch (e) {
          logger.debug(`[SSH] vpsId=${vpsId} Removing dead connection from pool`);
          conn.client.end();
          pool = pool.filter(c => c !== conn);
          this.connections.set(vpsId, pool);
        }
      }
    }

    // Если нет свободных, проверяем лимит
    if (pool.length >= this.MAX_CONNECTIONS_PER_VPS) {
      throw new Error(`Connection pool limit reached for VPS ${vpsId}`);
    }

    // Создаем новое соединение
    const vpsRaw = await dbManager.getVPS(vpsId);
    if (!vpsRaw) throw new Error(`VPS with id ${vpsId} not found in database`);

    const vpsConfig: VPSConfig = {
      id: vpsRaw.id,
      host: vpsRaw.host,
      port: vpsRaw.port,
      username: vpsRaw.username,
      authType: vpsRaw.auth_type || 'password', // Default to password
      password: vpsRaw.encrypted_password ? decrypt(vpsRaw.encrypted_password) : undefined,
      privateKey: vpsRaw.private_key // Assuming it's already PEM if exists
    };

    const client = await this.connect(vpsConfig);
    const newConn: PoolConnection = {
      client,
      lastUsed: new Date(),
      vpsConfig,
      inUse: true
    };

    pool.push(newConn);
    this.connections.set(vpsId, pool);
    return newConn;
  }

  /**
   * Освобождает соединение (возвращает в пул)
   */
  private releaseConnection(vpsId: number, conn: PoolConnection): void {
    conn.inUse = false;
    conn.lastUsed = new Date();
    logger.debug(`[SSH] vpsId=${vpsId} Connection released to pool`);
  }

  /**
   * Проверка живости соединения
   */
  private async ping(client: Client): Promise<void> {
    return new Promise((resolve, reject) => {
      client.exec('echo "ping"', (err, stream) => {
        if (err) return reject(err);
        stream.on('close', () => resolve()).on('data', () => {});
      });
    });
  }

  /**
   * Очистка простаивающих соединений
   */
  public cleanupIdleConnections(): void {
    const now = Date.now();
    for (const [vpsId, pool] of this.connections.entries()) {
      const activePool = pool.filter(conn => {
        const isIdle = !conn.inUse && (now - conn.lastUsed.getTime() > this.IDLE_TIMEOUT_MS);
        if (isIdle) {
          logger.debug(`[SSH] vpsId=${vpsId} Closing idle connection`);
          conn.client.end();
          return false;
        }
        return true;
      });
      if (activePool.length === 0) {
        this.connections.delete(vpsId);
      } else {
        this.connections.set(vpsId, activePool);
      }
    }
  }

  /**
   * Выполнение команды на сервере
   */
  public async executeCommand(vpsId: number, command: string, timeout: number = 15000): Promise<SSHResult> {
    let attempts = 0;
    const maxAttempts = 3;
    let lastError: any;

    while (attempts < maxAttempts) {
      attempts++;
      const startTime = Date.now();
      let conn: PoolConnection | undefined;

      try {
        logger.debug(`[SSH] vpsId=${vpsId} Executing command: ${command} (Attempt ${attempts})`);
        conn = await this.getConnection(vpsId);
        const authMethod = conn.vpsConfig.authType;

        const output = await new Promise<string>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('timeout')), timeout);

          conn!.client.exec(command, (err, stream) => {
            if (err) {
              clearTimeout(timer);
              return reject(err);
            }
            let res = '';
            stream
              .on('close', (code: number) => {
                clearTimeout(timer);
                if (code !== 0) reject(new Error(`Exit code ${code}`));
                else resolve(res);
              })
              .on('data', (data: any) => {
                res += data.toString();
              })
              .stderr.on('data', (data: any) => {
                res += data.toString();
              });
          });
        });

        const duration = Date.now() - startTime;
        logger.info(`[SSH] vpsId=${vpsId} method=${authMethod} command=${command} duration=${duration}ms SUCCESS`);
        
        await this.updateVPSStatus(vpsId, 'online');
        this.releaseConnection(vpsId, conn);

        return {
          success: true,
          output,
          duration,
          authMethodUsed: authMethod
        };

      } catch (error: any) {
        const duration = Date.now() - startTime;
        const errorType = this.checkVPSError(error.message).errorType || 'unknown';
        
        logger.error(`[SSH] vpsId=${vpsId} Command failed: ${error.message} (Type: ${errorType})`);

        if (errorType === 'auth') {
          await this.updateVPSStatus(vpsId, 'auth_error', error.message);
          if (conn) this.releaseConnection(vpsId, conn);
          return { success: false, error: error.message, errorType: 'auth', duration };
        }

        if (errorType === 'connection') {
          await this.updateVPSStatus(vpsId, 'offline', error.message);
        }

        if (conn) {
          conn.client.end(); // Close failed connection
          // Remove from pool
          const pool = this.connections.get(vpsId) || [];
          this.connections.set(vpsId, pool.filter(c => c !== conn));
        }

        lastError = error;
        
        if (attempts < maxAttempts) {
          const delay = attempts * 1000;
          logger.debug(`[SSH] vpsId=${vpsId} Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    return {
      success: false,
      error: lastError.message,
      errorType: this.checkVPSError(lastError.message).errorType || 'unknown'
    };
  }

  /**
   * Выполнение скрипта на сервере
   */
  public async executeScript(vpsId: number, scriptName: string, args: string[] = []): Promise<SSHResult> {
    const command = `${this.SCRIPT_PATH} ${scriptName} ${args.join(' ')}`;
    logger.info(`[SSH] vpsId=${vpsId} Executing script: ${scriptName} with args: ${args.join(', ')}`);
    return this.executeCommand(vpsId, command);
  }

  /**
   * Проверка соединения
   */
  public async testConnection(vpsId: number): Promise<{ success: boolean; error?: string; errorType?: string }> {
    const result = await this.executeCommand(vpsId, 'echo "pong"', 5000);
    return {
      success: result.success,
      error: result.error,
      errorType: result.errorType
    };
  }

  /**
   * Получение статуса WireGuard
   */
  public async getWireguardStatus(vpsId: number): Promise<WireguardStatus> {
    const result = await this.executeCommand(vpsId, 'wg show wg0', 5000);
    
    if (!result.success || !result.output) {
      return { running: false, peers: 0, transfer: '0' };
    }

    const output = result.output;
    const peersCount = (output.match(/peer:/g) || []).length;
    
    // Parse public key
    const pubKeyMatch = output.match(/public key: (.+)/);
    const publicKey = pubKeyMatch ? pubKeyMatch[1].trim() : undefined;

    // Parse listen port
    const portMatch = output.match(/listening port: (\d+)/);
    const listenPort = portMatch ? parseInt(portMatch[1]) : undefined;

    // Simple parsing for transfer (example: "transfer: 1.23 GiB received, 4.56 GiB sent")
    const transferMatch = output.match(/transfer: (.+)/);
    const transfer = transferMatch ? transferMatch[1] : '0';

    return {
      running: true,
      peers: peersCount,
      transfer,
      public_key: publicKey,
      listen_port: listenPort
    };
  }

  /**
   * Анализ ошибок SSH
   */
  public checkVPSError(errorStr: string): { hasError: boolean; errorType?: 'auth' | 'connection' | 'unknown' } {
    const lowerError = errorStr.toLowerCase();
    
    const authKeywords = [
      'authentication failed',
      'permission denied',
      'all configured authentication methods failed',
      'unable to authenticate',
      'password authentication failed'
    ];

    const connKeywords = [
      'connection refused',
      'etimedout',
      'enotfound',
      'econnrefused',
      'no route to host',
      'timeout',
      'timed out',
      'socket closed'
    ];

    if (authKeywords.some(kw => lowerError.includes(kw))) {
      return { hasError: true, errorType: 'auth' };
    }

    if (connKeywords.some(kw => lowerError.includes(kw))) {
      return { hasError: true, errorType: 'connection' };
    }

    return { hasError: true, errorType: 'unknown' };
  }

  /**
   * Обновление статуса VPS в базе данных
   */
  private async updateVPSStatus(vpsId: number, status: VPSStatus, error?: string): Promise<void> {
    try {
      await dbManager.updateVPSStatus(vpsId, status);
      if (error) {
        logger.debug(`[SSH] vpsId=${vpsId} Status updated to ${status} with error: ${error}`);
      }
    } catch (err) {
      logger.error(`[SSH] Failed to update VPS status in DB for vpsId=${vpsId}:`, err);
    }
  }

  /**
   * Закрыть все соединения
   */
  public closeAllConnections(): void {
    for (const pool of this.connections.values()) {
      for (const conn of pool) {
        conn.client.end();
      }
    }
    this.connections.clear();
    logger.info('[SSH] All connections closed');
  }

  /**
   * Получить статистику пула
   */
  public getPoolStats(): { total: number; active: number; idle: number } {
    let total = 0;
    let active = 0;
    let idle = 0;

    for (const pool of this.connections.values()) {
      total += pool.length;
      for (const conn of pool) {
        if (conn.inUse) active++;
        else idle++;
      }
    }

    return { total, active, idle };
  }

  /**
   * Задел на будущее: добавление SSH ключа
   */
  public async addSSHKeyAuth(vpsId: number, privateKey: string): Promise<void> {
    // В будущем здесь будет логика обновления VPS в БД для использования ключа
    logger.info(`[SSH] vpsId=${vpsId} SSH key auth addition requested (not implemented)`);
  }
}

// Экспорт единственного экземпляра
const sshManager = new SSHManager();
export default sshManager;
