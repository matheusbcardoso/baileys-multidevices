const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Configuração do diretório de dados
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Abrir banco de dados
const db = new Database(path.join(DATA_DIR, 'whatsapp.db'));

// Verificar tabelas existentes
console.log('Verificando tabelas no banco de dados...');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('Tabelas encontradas:', tables.map(t => t.name).join(', '));

// Verificar estrutura da tabela de mensagens
console.log('\nEstrutura da tabela de mensagens:');
try {
    const messageColumns = db.prepare("PRAGMA table_info(messages)").all();
    console.log(messageColumns);
} catch (error) {
    console.error('Erro ao verificar estrutura da tabela de mensagens:', error);
}

// Contar mensagens
console.log('\nContagem de mensagens:');
try {
    const count = db.prepare('SELECT COUNT(*) as count FROM messages').get();
    console.log(`Total de mensagens: ${count.count}`);
} catch (error) {
    console.error('Erro ao contar mensagens:', error);
}

// Listar dispositivos
console.log('\nDispositivos cadastrados:');
try {
    const devices = db.prepare('SELECT id, name, phone, status FROM devices').all();
    devices.forEach(device => {
        console.log(`- ${device.name} (${device.id}): ${device.status}, Telefone: ${device.phone || 'N/A'}`);
        
        // Contar mensagens para este dispositivo
        const msgCount = db.prepare('SELECT COUNT(*) as count FROM messages WHERE device_id = ?').get(device.id);
        console.log(`  Mensagens: ${msgCount.count}`);
    });
} catch (error) {
    console.error('Erro ao listar dispositivos:', error);
}

// Adicionar mensagens de teste se não houver nenhuma
console.log('\nVerificando necessidade de adicionar mensagens de teste...');
try {
    const count = db.prepare('SELECT COUNT(*) as count FROM messages').get().count;
    
    if (count === 0) {
        console.log('Nenhuma mensagem encontrada. Adicionando mensagens de teste...');
        
        // Obter todos os dispositivos
        const devices = db.prepare('SELECT id, phone FROM devices').all();
        
        if (devices.length === 0) {
            console.log('Nenhum dispositivo encontrado para inserir mensagens de teste.');
        } else {
            console.log(`Inserindo mensagens de teste para ${devices.length} dispositivos...`);
            
            // Para cada dispositivo, inserir algumas mensagens de teste
            devices.forEach(device => {
                const phone = device.phone || '5511999999999@s.whatsapp.net';
                
                // Mensagem recebida
                db.prepare(`
                    INSERT INTO messages (device_id, direction, sender, recipient, message, status)
                    VALUES (?, ?, ?, ?, ?, ?)
                `).run(
                    device.id,
                    'incoming',
                    phone,
                    'me@s.whatsapp.net',
                    'Olá, esta é uma mensagem de teste recebida',
                    'delivered'
                );
                
                // Mensagem enviada
                db.prepare(`
                    INSERT INTO messages (device_id, direction, sender, recipient, message, status)
                    VALUES (?, ?, ?, ?, ?, ?)
                `).run(
                    device.id,
                    'outgoing',
                    'me@s.whatsapp.net',
                    phone,
                    'Olá, esta é uma mensagem de teste enviada',
                    'sent'
                );
            });
            
            console.log('Mensagens de teste inseridas com sucesso.');
            
            // Verificar mensagens inseridas
            const messages = db.prepare('SELECT * FROM messages').all();
            console.log('\nMensagens no banco de dados:');
            messages.forEach(msg => {
                console.log(`- ID: ${msg.id}, Dispositivo: ${msg.device_id}, Direção: ${msg.direction}`);
                console.log(`  De: ${msg.sender}, Para: ${msg.recipient}`);
                console.log(`  Mensagem: ${msg.message}`);
                console.log(`  Status: ${msg.status}, Timestamp: ${msg.timestamp}`);
                console.log('---');
            });
        }
    } else {
        console.log(`Já existem ${count} mensagens no banco de dados.`);
        
        // Mostrar algumas mensagens
        const messages = db.prepare('SELECT * FROM messages LIMIT 5').all();
        console.log('\nPrimeiras 5 mensagens no banco de dados:');
        messages.forEach(msg => {
            console.log(`- ID: ${msg.id}, Dispositivo: ${msg.device_id}, Direção: ${msg.direction}`);
            console.log(`  De: ${msg.sender}, Para: ${msg.recipient}`);
            console.log(`  Mensagem: ${msg.message}`);
            console.log(`  Status: ${msg.status}, Timestamp: ${msg.timestamp}`);
            console.log('---');
        });
    }
} catch (error) {
    console.error('Erro ao verificar/adicionar mensagens de teste:', error);
}

console.log('\nVerificação do banco de dados concluída.');
