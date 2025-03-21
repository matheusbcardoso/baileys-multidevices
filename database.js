const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { proto } = require('@whiskeysockets/baileys');
const { Buffer } = require('buffer');

// Garantir que o diretório de dados exista
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Inicialização do banco de dados
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
            message TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (device_id) REFERENCES devices (id)
        )
    `);
    
    // Verificar se as tabelas foram criadas
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    console.log('Tabelas no banco de dados:', tables.map(t => t.name).join(', '));
    
    // Verificar estrutura da tabela de mensagens
    try {
        const messageColumns = db.prepare("PRAGMA table_info(messages)").all();
        console.log('Estrutura da tabela de mensagens:', JSON.stringify(messageColumns));
    } catch (error) {
        console.error('Erro ao verificar estrutura da tabela de mensagens:', error);
    }
    
    // Tabela para armazenar as sessões do WhatsApp
    db.exec(`
        CREATE TABLE IF NOT EXISTS auth_sessions (
            device_id TEXT PRIMARY KEY,
            auth_data TEXT NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    
    // Tabela para armazenar as credenciais do WhatsApp
    db.exec(`
        CREATE TABLE IF NOT EXISTS auth_keys (
            device_id TEXT NOT NULL,
            key_id TEXT NOT NULL,
            key_value TEXT NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (device_id, key_id)
        )
    `);

    console.log('Database initialized');
}

// Função para inserir mensagens de teste
function insertTestMessages() {
    try {
        // Verificar se já existem mensagens
        const count = db.prepare('SELECT COUNT(*) as count FROM messages').get().count;
        
        if (count > 0) {
            console.log(`Já existem ${count} mensagens no banco de dados. Pulando inserção de mensagens de teste.`);
            return;
        }
        
        // Obter todos os dispositivos
        const devices = db.prepare('SELECT id, phone FROM devices').all();
        
        if (devices.length === 0) {
            console.log('Nenhum dispositivo encontrado para inserir mensagens de teste.');
            return;
        }
        
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
    } catch (error) {
        console.error('Erro ao inserir mensagens de teste:', error);
    }
}

// Módulo para gerenciar dispositivos
const devices = {
    // Adicionar novo dispositivo
    addDevice: (id, name) => {
        const stmt = db.prepare('INSERT INTO devices (id, name) VALUES (?, ?)');
        stmt.run(id, name);
        return { id, name };
    },
    
    // Obter todos os dispositivos
    getAllDevices: () => {
        const stmt = db.prepare('SELECT * FROM devices ORDER BY created_at DESC');
        return stmt.all();
    },
    
    // Obter dispositivo por ID
    getDeviceById: (id) => {
        const stmt = db.prepare('SELECT * FROM devices WHERE id = ?');
        return stmt.get(id);
    },
    
    // Atualizar status do dispositivo
    updateDeviceStatus: (id, status, phone = null) => {
        let stmt;
        if (status === 'connected' && phone) {
            stmt = db.prepare('UPDATE devices SET status = ?, phone = ?, last_connected = CURRENT_TIMESTAMP WHERE id = ?');
            stmt.run(status, phone, id);
        } else {
            stmt = db.prepare('UPDATE devices SET status = ? WHERE id = ?');
            stmt.run(status, id);
        }
    },
    
    // Remover dispositivo
    removeDevice: (id) => {
        try {
            // Verificar se o dispositivo existe antes de remover
            const checkStmt = db.prepare('SELECT id FROM devices WHERE id = ?');
            const device = checkStmt.get(id);
            
            if (!device) {
                console.log(`Dispositivo ${id} não encontrado para remoção`);
                return false;
            }
            
            // Iniciar uma transação para garantir que todas as operações sejam concluídas
            const transaction = db.transaction(() => {
                // Remover mensagens associadas ao dispositivo
                const stmtMessages = db.prepare('DELETE FROM messages WHERE device_id = ?');
                stmtMessages.run(id);
                console.log(`Mensagens do dispositivo ${id} removidas`);
                
                // Verificar se a tabela auth_sessions existe antes de tentar excluir
                try {
                    const stmtSessions = db.prepare('DELETE FROM auth_sessions WHERE device_id = ?');
                    stmtSessions.run(id);
                    console.log(`Sessões do dispositivo ${id} removidas`);
                } catch (error) {
                    console.log(`Tabela auth_sessions não existe ou erro ao remover sessões: ${error.message}`);
                }
                
                // Verificar se a tabela auth_keys existe antes de tentar excluir
                try {
                    const stmtKeys = db.prepare('DELETE FROM auth_keys WHERE device_id = ?');
                    stmtKeys.run(id);
                    console.log(`Chaves do dispositivo ${id} removidas`);
                } catch (error) {
                    console.log(`Tabela auth_keys não existe ou erro ao remover chaves: ${error.message}`);
                }
                
                // Finalmente, remover o dispositivo
                const stmtDevice = db.prepare('DELETE FROM devices WHERE id = ?');
                stmtDevice.run(id);
                console.log(`Dispositivo ${id} removido`);
                
                return true;
            });
            
            // Executar a transação
            return transaction();
        } catch (error) {
            console.error(`Erro ao remover dispositivo ${id}:`, error);
            return false;
        }
    }
};

// Módulo para gerenciar mensagens
const messages = {
    // Adicionar nova mensagem
    addMessage: (deviceId, direction, sender, recipient, message) => {
        try {
            console.log(`Salvando mensagem ${direction} para dispositivo ${deviceId}`);
            console.log(`De: ${sender}, Para: ${recipient}`);
            
            // Verificar se o dispositivo existe
            const deviceCheck = db.prepare('SELECT id FROM devices WHERE id = ?');
            const device = deviceCheck.get(deviceId);
            
            if (!device) {
                console.error(`Dispositivo ${deviceId} não encontrado ao salvar mensagem`);
                return null;
            }
            
            const stmt = db.prepare(`
                INSERT INTO messages (device_id, direction, sender, recipient, message)
                VALUES (?, ?, ?, ?, ?)
            `);
            
            const result = stmt.run(deviceId, direction, sender, recipient, message);
            console.log(`Mensagem salva com ID ${result.lastInsertRowid}`);
            
            return result.lastInsertRowid;
        } catch (error) {
            console.error(`Erro ao salvar mensagem:`, error);
            return null;
        }
    },
    
    // Obter mensagens de um dispositivo
    getDeviceMessages: (deviceId) => {
        const stmt = db.prepare('SELECT * FROM messages WHERE device_id = ? ORDER BY timestamp DESC');
        return stmt.all(deviceId);
    },
    
    // Obter mensagens por dispositivo com limite
    getMessagesByDevice: (deviceId, limit = 50) => {
        try {
            console.log(`Buscando mensagens para dispositivo ${deviceId} com limite ${limit}`);
            
            const stmt = db.prepare(`
                SELECT * FROM messages 
                WHERE device_id = ? 
                ORDER BY timestamp DESC 
                LIMIT ?
            `);
            
            const messages = stmt.all(deviceId, limit);
            console.log(`Encontradas ${messages.length} mensagens para dispositivo ${deviceId}`);
            
            return messages;
        } catch (error) {
            console.error(`Erro ao buscar mensagens para dispositivo ${deviceId}:`, error);
            return [];
        }
    },
    
    // Obter todas as mensagens
    getAllMessages: (limit = 100) => {
        try {
            console.log(`Buscando todas as mensagens com limite ${limit}`);
            
            const stmt = db.prepare(`
                SELECT m.*, d.name as device_name 
                FROM messages m
                JOIN devices d ON m.device_id = d.id
                ORDER BY timestamp DESC 
                LIMIT ?
            `);
            
            const messages = stmt.all(limit);
            console.log(`Encontradas ${messages.length} mensagens no total`);
            
            return messages;
        } catch (error) {
            console.error(`Erro ao buscar todas as mensagens:`, error);
            return [];
        }
    },
    
    // Atualizar status da mensagem
    updateMessageStatus: (id, status) => {
        const stmt = db.prepare('UPDATE messages SET status = ? WHERE id = ?');
        stmt.run(status, id);
    }
};

// Módulo para gerenciar sessões do WhatsApp
const sessions = {
    // Salvar ou atualizar sessão
    saveSession: (deviceId, authData) => {
        const stmt = db.prepare(`
            INSERT INTO auth_sessions (device_id, auth_data, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(device_id) DO UPDATE SET
            auth_data = excluded.auth_data,
            updated_at = CURRENT_TIMESTAMP
        `);
        stmt.run(deviceId, JSON.stringify(authData));
    },
    
    // Obter sessão por ID do dispositivo
    getSession: (deviceId) => {
        const stmt = db.prepare('SELECT auth_data FROM auth_sessions WHERE device_id = ?');
        const result = stmt.get(deviceId);
        return result ? JSON.parse(result.auth_data) : null;
    },
    
    // Salvar ou atualizar chave
    saveKey: (deviceId, keyId, keyValue) => {
        const stmt = db.prepare(`
            INSERT INTO auth_keys (device_id, key_id, key_value, updated_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(device_id, key_id) DO UPDATE SET
            key_value = excluded.key_value,
            updated_at = CURRENT_TIMESTAMP
        `);
        stmt.run(deviceId, keyId, keyValue);
    },
    
    // Obter todas as chaves de um dispositivo
    getKeys: (deviceId) => {
        const stmt = db.prepare('SELECT key_id, key_value FROM auth_keys WHERE device_id = ?');
        const keys = stmt.all(deviceId);
        return keys.reduce((obj, item) => {
            obj[item.key_id] = item.key_value;
            return obj;
        }, {});
    },
    
    // Implementação do useMultiFileAuthState usando SQLite
    useSQLiteAuthState: (deviceId) => {
        const saveCreds = async (creds) => {
            try {
                sessions.saveSession(deviceId, creds);
                console.log(`Credenciais salvas para dispositivo ${deviceId}`);
            } catch (error) {
                console.error('Erro ao salvar credenciais:', error);
            }
        };
        
        const getState = async () => {
            try {
                const creds = sessions.getSession(deviceId);
                if (creds) {
                    console.log(`Credenciais carregadas para dispositivo ${deviceId}`);
                    return creds;
                } else {
                    console.log(`Nenhuma credencial encontrada para dispositivo ${deviceId}, criando nova`);
                    return { 
                        creds: { 
                            me: { id: '', name: '' }, 
                            noiseKey: { private: Buffer.alloc(32), public: Buffer.alloc(32) },
                            signedIdentityKey: { private: Buffer.alloc(32), public: Buffer.alloc(32) },
                            signedPreKey: {
                                keyPair: { private: Buffer.alloc(32), public: Buffer.alloc(32) },
                                signature: Buffer.alloc(64),
                                keyId: 1
                            },
                            registrationId: 0,
                            advSecretKey: '',
                            nextPreKeyId: 1,
                            firstUnuploadedPreKeyId: 1,
                            serverHasPreKeys: false,
                            account: {
                                details: '',
                                accountSignatureKey: '',
                                accountSignature: '',
                                deviceSignature: ''
                            },
                            deviceId: '',
                            phoneId: '',
                            identityId: Buffer.alloc(20),
                            registered: false,
                            backupToken: Buffer.alloc(20),
                            registration: {},
                            pairingCode: ''
                        }
                    };
                }
            } catch (error) {
                console.error('Erro ao carregar credenciais:', error);
                return { 
                    creds: { 
                        me: { id: '', name: '' }, 
                        noiseKey: { private: Buffer.alloc(32), public: Buffer.alloc(32) },
                        signedIdentityKey: { private: Buffer.alloc(32), public: Buffer.alloc(32) },
                        signedPreKey: {
                            keyPair: { private: Buffer.alloc(32), public: Buffer.alloc(32) },
                            signature: Buffer.alloc(64),
                            keyId: 1
                        },
                        registrationId: 0,
                        advSecretKey: '',
                        nextPreKeyId: 1,
                        firstUnuploadedPreKeyId: 1,
                        serverHasPreKeys: false,
                        account: {
                            details: '',
                            accountSignatureKey: '',
                            accountSignature: '',
                            deviceSignature: ''
                        },
                        deviceId: '',
                        phoneId: '',
                        identityId: Buffer.alloc(20),
                        registered: false,
                        backupToken: Buffer.alloc(20),
                        registration: {},
                        pairingCode: ''
                    }
                };
            }
        };
        
        return {
            state: getState,
            saveCreds
        };
    }
};

// Inicializar banco de dados
initDatabase();

// Inserir mensagens de teste
insertTestMessages();

module.exports = {
    initDatabase,
    devices,
    messages,
    sessions
};
