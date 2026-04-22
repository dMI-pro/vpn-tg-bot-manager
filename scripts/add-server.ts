import { run, initDb } from '../src/database/db.js';
import { encrypt } from '../src/utils/encryption.js';
import logger from '../src/utils/logger.js';

const addSampleServer = async () => {
  try {
    await initDb();
    
    const name = 'Main Server';
    const host = '1.2.3.4';
    const port = 22;
    const username = 'root';
    const password = encrypt('your_secret_password');
    
    await run(
      'INSERT INTO servers (name, host, port, username, password) VALUES (?, ?, ?, ?, ?)',
      [name, host, port, username, password]
    );
    
    logger.info('Sample server added successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Error adding sample server', error);
    process.exit(1);
  }
};

addSampleServer();
