import crypto from 'crypto';
import { execSync } from 'child_process';
import logger from './logger.js';

/**
 * Генерирует приватный ключ WireGuard
 */
export function generatePrivateKey(): string {
  return crypto.randomBytes(32).toString('base64');
}

/**
 * Генерирует публичный ключ из приватного с помощью команды wg
 * Требует установленного wireguard-tools в системе
 */
export function getPublicKey(privateKey: string): string {
  try {
    const publicKey = execSync(`echo "${privateKey}" | wg pubkey`).toString().trim();
    return publicKey;
  } catch (error) {
    logger.error('Failed to generate public key using wg command. Make sure wireguard-tools is installed.', error);
    // Fallback: В реальном проекте лучше использовать JS библиотеку для Curve25519
    // Но по заданию пробуем через exec.
    throw new Error('wireguard-tools not found in system');
  }
}

/**
 * Формирует содержимое .conf файла
 */
export function generateConfigContent(data: {
  privateKey: string;
  address: string;
  serverPublicKey: string;
  endpoint: string;
  dns?: string;
}): string {
  return `[Interface]
PrivateKey = ${data.privateKey}
Address = ${data.address}/32
DNS = ${data.dns || '1.1.1.1'}

[Peer]
PublicKey = ${data.serverPublicKey}
Endpoint = ${data.endpoint}
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25
`;
}
