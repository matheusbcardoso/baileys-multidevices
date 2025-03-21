const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Garantir que o diretório de dados exista
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Inicializar o banco de dados
const db = new Database(path.join(DATA_DIR, 'whatsapp.db'));

// Criar tabelas se não existirem
function initDatabase() {
    // Tabela de dispositivos
    db.exec(`
        CREATE TABLE IF NOT EXISTS devices (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            phone TEXT,
            status TEXT DEFAULT 'disconnected',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_connected TIMESTAMP
        )
    `);

    // Tabela de mensagens
    db.exec(`
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT NOT NULL,
            direction TEXT NOT NULL,
            sender TEXT NOT NULL,
            recipient TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            status TEXT DEFAULT 'pending',
            FOREIGN KEY (device_id) REFERENCES devices (id)
        )
    `);

    console.log('Database initialized');
}

// Métodos para gerenciar dispositivos
const deviceMethods = {
    // Adicionar novo dispositivo
    addDevice(id, name) {
        const stmt = db.prepare('INSERT INTO devices (id, name, status) VALUES (?, ?, ?)');
        return stmt.run(id, name, 'disconnected');
    },

    // Atualizar status do dispositivo
    updateDeviceStatus(id, status, phone = null) {
        let stmt;
        if (phone) {
            stmt = db.prepare('UPDATE devices SET status = ?, phone = ?, last_connected = CURRENT_TIMESTAMP WHERE id = ?');
            return stmt.run(status, phone, id);
        } else {
            stmt = db.prepare('UPDATE devices SET status = ?, last_connected = CURRENT_TIMESTAMP WHERE id = ?');
            return stmt.run(status, id);
        }
    },

    // Obter todos os dispositivos
    getAllDevices() {
        const stmt = db.prepare('SELECT * FROM devices ORDER BY last_connected DESC');
        return stmt.all();
    },

    // Obter dispositivo por ID
    getDeviceById(id) {
        const stmt = db.prepare('SELECT * FROM devices WHERE id = ?');
        return stmt.get(id);
    },

    // Obter dispositivos conectados
    getConnectedDevices() {
        const stmt = db.prepare("SELECT * FROM devices WHERE status = 'connected' ORDER BY last_connected DESC");
        return stmt.all();
    },

    // Remover dispositivo
    removeDevice(id) {
        const stmt = db.prepare('DELETE FROM devices WHERE id = ?');
        return stmt.run(id);
    }
};

// Métodos para gerenciar mensagens
const messageMethods = {
    // Adicionar nova mensagem
    addMessage(deviceId, direction, sender, recipient, content) {
        const stmt = db.prepare(`
            INSERT INTO messages (device_id, direction, sender, recipient, content, timestamp, status)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
        `);
        const status = direction === 'outgoing' ? 'pending' : 'received';
        return stmt.run(deviceId, direction, sender, recipient, content, status);
    },

    // Atualizar status da mensagem
    updateMessageStatus(id, status) {
        const stmt = db.prepare('UPDATE messages SET status = ? WHERE id = ?');
        return stmt.run(status, id);
    },

    // Obter mensagens por dispositivo
    getMessagesByDevice(deviceId, limit = 50) {
        const stmt = db.prepare(`
            SELECT * FROM messages 
            WHERE device_id = ? 
            ORDER BY timestamp DESC 
            LIMIT ?
        `);
        return stmt.all(deviceId, limit);
    },

    // Obter todas as mensagens
    getAllMessages(limit = 100) {
        const stmt = db.prepare(`
            SELECT m.*, d.name as device_name 
            FROM messages m
            JOIN devices d ON m.device_id = d.id
            ORDER BY timestamp DESC 
            LIMIT ?
        `);
        return stmt.all(limit);
    }
};

// Inicializar o banco de dados
initDatabase();

module.exports = {
    db,
    devices: deviceMethods,
    messages: messageMethods
};
