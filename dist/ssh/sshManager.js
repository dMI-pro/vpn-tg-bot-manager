import { Client } from 'ssh2';
import logger from '../utils/logger.js';
export class SSHManager {
    constructor(config) {
        this.config = config;
    }
    executeCommand(command) {
        return new Promise((resolve, reject) => {
            const conn = new Client();
            conn.on('ready', () => {
                logger.info(`SSH connection established to ${this.config.host}`);
                conn.exec(command, (err, stream) => {
                    if (err) {
                        conn.end();
                        return reject(err);
                    }
                    let output = '';
                    let errorOutput = '';
                    stream.on('close', (code, signal) => {
                        conn.end();
                        if (code !== 0) {
                            reject(new Error(`Command failed with code ${code}: ${errorOutput}`));
                        }
                        else {
                            resolve(output);
                        }
                    }).on('data', (data) => {
                        output += data.toString();
                    }).stderr.on('data', (data) => {
                        errorOutput += data.toString();
                    });
                });
            }).on('error', (err) => {
                logger.error(`SSH connection error to ${this.config.host}`, err);
                reject(err);
            }).connect({
                host: this.config.host,
                port: this.config.port,
                username: this.config.username,
                password: this.config.password,
                privateKey: this.config.privateKey,
            });
        });
    }
}
