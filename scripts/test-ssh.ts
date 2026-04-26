import { Client } from 'ssh2';

/**
 * Скрипт для ручного тестирования SSH подключения.
 * Использование: node scripts/test-ssh.js <host> <port> <username> <password>
 */

const args = process.argv.slice(2);
if (args.length < 4) {
  console.log('Использование: node scripts/test-ssh.js <host> <port> <username> <password>');
  process.exit(1);
}

const [host, port, username, password] = args;

console.log(`🚀 Тестирование SSH подключения к ${username}@${host}:${port}...`);

const conn = new Client();

conn.on('ready', () => {
  console.log('✅ Подключение установлено успешно!');
  
  console.log('📡 Выполнение тестовой команды: uptime...');
  conn.exec('uptime', (err, stream) => {
    if (err) {
      console.error('❌ Ошибка выполнения команды uptime:', err);
      conn.end();
      return;
    }
    
    stream.on('close', (code: number, signal: string) => {
      console.log(`✅ Команда завершена с кодом ${code}`);
      
      console.log('📡 Проверка наличия manager-tg-bot.sh...');
      conn.exec('ls -l /root/wireguard-manager/manager-tg-bot.sh', (err, stream) => {
        if (err) {
          console.error('❌ Ошибка проверки файла:', err);
          conn.end();
          return;
        }
        
        let output = '';
        stream.on('data', (data: Buffer) => {
          output += data.toString();
        });
        
        stream.on('close', (code: number) => {
          if (code === 0) {
            console.log('✅ Скрипт manager-tg-bot.sh найден!');
            console.log(output.trim());
          } else {
            console.warn('⚠️ Скрипт manager-tg-bot.sh НЕ найден. Убедитесь, что вы его установили.');
          }
          conn.end();
        });
      });
    }).on('data', (data: Buffer) => {
      console.log('STDOUT: ' + data.toString().trim());
    }).stderr.on('data', (data: Buffer) => {
      console.log('STDERR: ' + data.toString().trim());
    });
  });
}).on('error', (err) => {
  console.error('❌ Ошибка подключения:', err.message);
  process.exit(1);
}).on('end', () => {
  console.log('🔌 Соединение закрыто.');
  process.exit(0);
}).connect({
  host,
  port: parseInt(port),
  username,
  password,
  readyTimeout: 10000
});
