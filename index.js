const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
// Configuração para o Baileys
global.crypto = require('crypto');
global.WebSocket = require('ws');
global.fetch = require('node-fetch');
global.performance = require('perf_hooks').performance;
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const fs = require('fs');
const pino = require('pino');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');

// Inicializar o banco de dados
db.initDatabase();

// Configuração do servidor Express
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    },
    maxHttpBufferSize: 1e8, // 100MB
    pingTimeout: 60000
});

// Configurar middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Pasta para armazenar as sessões
const SESSIONS_DIR = './sessions';
if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

// Armazenar conexões ativas
const connections = {};

// Armazenamento temporário de mensagens em memória
const messageStore = {
    messages: {},
    
    addMessage: function(deviceId, direction, sender, recipient, content) {
        if (!this.messages[deviceId]) {
            this.messages[deviceId] = [];
        }
        
        const message = {
            id: Date.now() + Math.floor(Math.random() * 1000),
            deviceId,
            direction,
            sender,
            recipient,
            message: content,
            timestamp: new Date().toISOString(),
            status: direction === 'outgoing' ? 'sent' : 'received'
        };
        
        this.messages[deviceId].push(message);
        console.log(`Mensagem adicionada ao armazenamento temporário para ${deviceId}`);
        
        return message;
    },
    
    getMessages: function(deviceId, limit = 50) {
        if (!deviceId) {
            // Retornar todas as mensagens
            let allMessages = [];
            Object.values(this.messages).forEach(deviceMessages => {
                allMessages = allMessages.concat(deviceMessages);
            });
            
            // Ordenar por timestamp (mais recentes primeiro)
            allMessages.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            
            return allMessages.slice(0, limit);
        }
        
        // Retornar mensagens de um dispositivo específico
        const deviceMessages = this.messages[deviceId] || [];
        
        // Ordenar por timestamp (mais recentes primeiro)
        deviceMessages.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        return deviceMessages.slice(0, limit);
    },
    
    clearMessages: function(deviceId) {
        if (deviceId) {
            // Limpar mensagens de um dispositivo específico
            this.messages[deviceId] = [];
            console.log(`Mensagens do dispositivo ${deviceId} removidas`);
        } else {
            // Limpar todas as mensagens
            this.messages = {};
            console.log('Todas as mensagens removidas');
        }
    }
};

// Adicionar mensagens de teste para cada dispositivo
function addTestMessages() {
    // Obter dispositivos do banco de dados
    const devices = db.devices.getAllDevices();
    
    devices.forEach(device => {
        // Adicionar mensagem recebida de teste
        messageStore.addMessage(
            device.id,
            'incoming',
            '5511999999999@s.whatsapp.net',
            device.phone || 'unknown',
            'Esta é uma mensagem de teste recebida'
        );
        
        // Adicionar mensagem enviada de teste
        messageStore.addMessage(
            device.id,
            'outgoing',
            device.phone || 'unknown',
            '5511999999999@s.whatsapp.net',
            'Esta é uma mensagem de teste enviada'
        );
    });
    
    console.log('Mensagens de teste adicionadas ao armazenamento temporário');
}

// Inicializar mensagens de teste
setTimeout(addTestMessages, 5000);

// Função para iniciar a conexão com o WhatsApp
async function connectToWhatsApp(deviceId, deviceName) {
    try {
        // Criar pasta para a sessão específica do dispositivo
        const sessionDir = path.join(SESSIONS_DIR, deviceId);
        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
        }
        
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        
        // Configuração do logger
        const logger = pino({ level: 'warn' });
        
        // Criar conexão
        const sock = makeWASocket({
            printQRInTerminal: true,
            auth: state,
            logger,
            browser: ['WhatsApp Integration', 'Chrome', '10.0'],
            syncFullHistory: false,
            connectTimeoutMs: 60000,
            qrTimeout: 60000,
            defaultQueryTimeoutMs: 60000
        });
        
        // Armazenar a conexão
        connections[deviceId] = {
            socket: sock,
            qrCode: '',
            isConnected: false,
            name: deviceName,
            reconnecting: false
        };
        
        // Evento de atualização de conexão
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                try {
                    // Gerar QR code como string base64
                    connections[deviceId].qrCode = await QRCode.toDataURL(qr);
                    io.emit('device-qr', { deviceId, qrCode: connections[deviceId].qrCode });
                    console.log(`QR Code gerado para dispositivo ${deviceId}`);
                } catch (error) {
                    console.error('Erro ao gerar QR code:', error);
                }
            }
            
            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                console.log(`Conexão fechada para dispositivo ${deviceId} devido a `, lastDisconnect?.error);
                connections[deviceId].isConnected = false;
                
                // Atualizar status no banco de dados
                db.devices.updateDeviceStatus(deviceId, 'disconnected');
                
                // Emitir evento para o frontend
                io.emit('device-status', { deviceId, connected: false });
                
                if (shouldReconnect) {
                    connectToWhatsApp(deviceId, deviceName);
                }
            } else if (connection === 'open') {
                console.log(`Conexão aberta para dispositivo ${deviceId}`);
                connections[deviceId].isConnected = true;
                
                // Obter informações do telefone
                const phoneNumber = sock.user?.id?.split(':')[0] || '';
                
                // Atualizar status no banco de dados
                db.devices.updateDeviceStatus(deviceId, 'connected', phoneNumber);
                
                // Emitir evento para o frontend
                io.emit('device-status', { 
                    deviceId, 
                    connected: true,
                    phoneNumber 
                });
            }
        });
        
        // Salvar credenciais quando atualizadas
        sock.ev.on('creds.update', async (newCreds) => {
            try {
                await saveCreds(newCreds);
                console.log('Credenciais atualizadas com sucesso');
            } catch (error) {
                console.error('Erro ao atualizar credenciais:', error);
            }
        });
        
        // Evento para receber mensagens
        sock.ev.on('messages.upsert', async (m) => {
            try {
                if (m.type === 'notify') {
                    for (const msg of m.messages) {
                        try {
                            if (!msg.key.fromMe && msg.message) {
                                const sender = msg.key.remoteJid;
                                const messageContent = msg.message.conversation || 
                                                    (msg.message.extendedTextMessage && msg.message.extendedTextMessage.text) || 
                                                    (msg.message.imageMessage && msg.message.imageMessage.caption) || 
                                                    'Mídia recebida';
                                
                                console.log(`Nova mensagem para ${deviceId} de ${sender}: ${messageContent}`);
                                
                                // Salvar mensagem no banco de dados
                                try {
                                    const recipientId = sock.user?.id || 'unknown';
                                    db.messages.addMessage(
                                        deviceId,
                                        'incoming',
                                        sender,
                                        recipientId,
                                        messageContent
                                    );
                                } catch (dbError) {
                                    console.error(`Erro ao salvar mensagem recebida no banco de dados:`, dbError);
                                }
                                
                                // Adicionar mensagem ao armazenamento temporário
                                messageStore.addMessage(
                                    deviceId,
                                    'incoming',
                                    sender,
                                    sock.user?.id || 'unknown',
                                    messageContent
                                );
                                
                                // Emitir evento para o frontend
                                io.emit('new-message', {
                                    deviceId,
                                    sender,
                                    message: messageContent,
                                    timestamp: new Date().toISOString()
                                });
                            }
                        } catch (msgError) {
                            console.error(`Erro ao processar mensagem individual:`, msgError);
                        }
                    }
                }
            } catch (error) {
                console.error(`Erro ao processar lote de mensagens:`, error);
            }
        });
    } catch (error) {
        console.error('Erro ao conectar ao WhatsApp:', error);
    }
}

// Rota principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Rota para a página principal após login
app.get('/index.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Rota para logout
app.get('/logout', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'logout.html'));
});

// API para gerenciar dispositivos
app.get('/api/devices', (req, res) => {
    const devices = db.devices.getAllDevices();
    
    // Adicionar informações de status em tempo real
    const devicesWithStatus = devices.map(device => {
        const connection = connections[device.id];
        return {
            ...device,
            isConnected: connection ? connection.isConnected : false,
            hasQrCode: connection && connection.qrCode && !connection.isConnected
        };
    });
    
    res.json(devicesWithStatus);
});

app.post('/api/devices', (req, res) => {
    const { name } = req.body;
    
    if (!name) {
        return res.status(400).json({ success: false, message: 'Nome do dispositivo é obrigatório' });
    }
    
    // Gerar ID único para o dispositivo
    const deviceId = uuidv4();
    
    // Adicionar ao banco de dados
    db.devices.addDevice(deviceId, name);
    
    // Iniciar conexão
    connectToWhatsApp(deviceId, name);
    
    res.json({ 
        success: true, 
        deviceId,
        message: 'Dispositivo adicionado com sucesso' 
    });
});

app.delete('/api/devices/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Verificar se o dispositivo existe
        const device = db.devices.getDeviceById(id);
        if (!device) {
            return res.status(404).json({ success: false, message: 'Dispositivo não encontrado' });
        }
        
        console.log(`Removendo dispositivo ${id} (${device.name})`);
        
        // Desconectar e remover da lista de conexões
        if (connections[id]) {
            if (connections[id].socket) {
                try {
                    await connections[id].socket.logout();
                    console.log(`Logout realizado para dispositivo ${id}`);
                } catch (error) {
                    console.error(`Erro ao fazer logout do dispositivo ${id}:`, error);
                }
                
                try {
                    connections[id].socket.end();
                    console.log(`Conexão encerrada para dispositivo ${id}`);
                } catch (error) {
                    console.error(`Erro ao encerrar conexão do dispositivo ${id}:`, error);
                }
            }
            delete connections[id];
            console.log(`Conexão removida da lista para dispositivo ${id}`);
        }
        
        // Remover pasta da sessão
        try {
            const sessionDir = path.join(SESSIONS_DIR, id);
            if (fs.existsSync(sessionDir)) {
                fs.rmSync(sessionDir, { recursive: true, force: true });
                console.log(`Pasta de sessão removida para dispositivo ${id}`);
            }
        } catch (error) {
            console.error(`Erro ao remover pasta de sessão do dispositivo ${id}:`, error);
        }
        
        // Remover do banco de dados
        const dbRemovalResult = db.devices.removeDevice(id);
        if (!dbRemovalResult) {
            return res.status(500).json({ success: false, message: 'Erro ao remover dispositivo do banco de dados' });
        }
        
        console.log(`Dispositivo ${id} removido com sucesso`);
        res.json({ success: true, message: 'Dispositivo removido com sucesso' });
    } catch (error) {
        console.error('Erro ao remover dispositivo:', error);
        res.status(500).json({ success: false, message: 'Erro ao remover dispositivo' });
    }
});

app.get('/api/devices/:id/qrcode', async (req, res) => {
    try {
        const { id } = req.params;
        
        console.log(`Solicitação de QR code para dispositivo ${id}`);
        
        // Verificar se o dispositivo existe
        const device = db.devices.getDeviceById(id);
        if (!device) {
            console.log(`Dispositivo ${id} não encontrado`);
            return res.status(404).json({ success: false, message: 'Dispositivo não encontrado' });
        }
        
        // Verificar se há QR code disponível
        if (connections[id]) {
            if (connections[id].isConnected) {
                console.log(`Dispositivo ${id} já está conectado`);
                return res.json({ success: true, connected: true, message: 'Dispositivo já está conectado' });
            }
            
            if (connections[id].qrCode) {
                console.log(`QR code disponível para dispositivo ${id}`);
                return res.json({ success: true, qrcode: connections[id].qrCode });
            } else {
                // Se não há QR code, tenta reconectar o dispositivo
                if (!connections[id].reconnecting) {
                    connections[id].reconnecting = true;
                    console.log(`Tentando reconectar dispositivo ${id} para gerar QR code`);
                    
                    // Forçar reconexão para gerar novo QR code
                    if (connections[id].socket) {
                        try {
                            await connections[id].socket.logout();
                            console.log(`Logout realizado para dispositivo ${id}`);
                        } catch (error) {
                            console.log(`Erro ao desconectar dispositivo ${id}:`, error);
                        }
                    }
                    
                    // Remover pasta da sessão para forçar novo QR code
                    try {
                        const sessionDir = path.join(SESSIONS_DIR, id);
                        if (fs.existsSync(sessionDir)) {
                            fs.rmSync(sessionDir, { recursive: true, force: true });
                            console.log(`Pasta de sessão removida para dispositivo ${id}`);
                        }
                    } catch (error) {
                        console.log(`Erro ao remover pasta de sessão para dispositivo ${id}:`, error);
                    }
                    
                    // Iniciar nova conexão
                    setTimeout(() => {
                        try {
                            connectToWhatsApp(id, device.name);
                            console.log(`Nova conexão iniciada para dispositivo ${id}`);
                        } catch (error) {
                            console.error(`Erro ao iniciar nova conexão para dispositivo ${id}:`, error);
                        }
                        connections[id].reconnecting = false;
                    }, 1000);
                }
                
                console.log(`Gerando novo QR code para dispositivo ${id}`);
                return res.status(202).json({ 
                    success: true, 
                    message: 'Gerando novo QR code, tente novamente em alguns segundos',
                    retry: true 
                });
            }
        } else {
            // Se não há conexão, inicia uma nova
            console.log(`Iniciando nova conexão para dispositivo ${id}`);
            try {
                connectToWhatsApp(id, device.name);
                console.log(`Conexão iniciada para dispositivo ${id}`);
            } catch (error) {
                console.error(`Erro ao iniciar conexão para dispositivo ${id}:`, error);
            }
            
            return res.status(202).json({ 
                success: true, 
                message: 'Iniciando conexão, tente novamente em alguns segundos',
                retry: true 
            });
        }
    } catch (error) {
        console.error(`Erro ao processar solicitação de QR code:`, error);
        res.status(500).json({ success: false, message: 'Erro ao processar solicitação de QR code' });
    }
});

// Rota para enviar mensagem
app.post('/api/send-message', async (req, res) => {
    try {
        const { deviceId, number, message } = req.body;
        
        console.log(`Tentando enviar mensagem para ${number} usando dispositivo ${deviceId}`);
        
        if (!deviceId || !number || !message) {
            console.log('Parâmetros incompletos:', { deviceId, number, message });
            return res.status(400).json({ 
                success: false, 
                message: 'Dispositivo, número e mensagem são obrigatórios' 
            });
        }
        
        // Verificar se o dispositivo existe
        if (!connections[deviceId]) {
            console.log(`Dispositivo ${deviceId} não encontrado`);
            return res.status(400).json({ 
                success: false, 
                message: 'Dispositivo não encontrado' 
            });
        }
        
        // Verificar se o socket existe
        if (!connections[deviceId].socket) {
            console.log(`Socket não existe para o dispositivo ${deviceId}`);
            return res.status(400).json({ 
                success: false, 
                message: 'Dispositivo não está conectado' 
            });
        }
        
        // Verificar se o dispositivo está conectado
        if (!connections[deviceId].isConnected) {
            console.log(`Dispositivo ${deviceId} não está conectado (isConnected = false)`);
            return res.status(400).json({ 
                success: false, 
                message: 'Dispositivo não está conectado ao WhatsApp' 
            });
        }
        
        // Formatar número (adicionar @s.whatsapp.net)
        const formattedNumber = number.includes('@') 
            ? number 
            : `${number.replace(/[^\d]/g, '')}@s.whatsapp.net`;
        
        console.log(`Enviando mensagem para ${formattedNumber} usando dispositivo ${deviceId}`);
        
        // Enviar mensagem
        try {
            const socket = connections[deviceId].socket;
            const result = await socket.sendMessage(formattedNumber, {
                text: message
            });
            
            console.log(`Mensagem enviada com sucesso:`, result);
            
            // Salvar mensagem no banco de dados
            try {
                const senderId = socket.user?.id || 'unknown';
                db.messages.addMessage(
                    deviceId,
                    'outgoing',
                    senderId,
                    formattedNumber,
                    message
                );
                console.log(`Mensagem salva no banco de dados`);
            } catch (dbError) {
                console.error('Erro ao salvar mensagem no banco de dados:', dbError);
                // Não retornar erro, pois a mensagem já foi enviada
            }
            
            // Adicionar mensagem ao armazenamento temporário
            messageStore.addMessage(
                deviceId,
                'outgoing',
                socket.user?.id || 'unknown',
                formattedNumber,
                message
            );
            
            res.json({ success: true, message: 'Mensagem enviada com sucesso' });
        } catch (sendError) {
            console.error(`Erro ao enviar mensagem para ${formattedNumber}:`, sendError);
            return res.status(500).json({ 
                success: false, 
                message: `Erro ao enviar mensagem: ${sendError.message}` 
            });
        }
    } catch (error) {
        console.error('Erro ao processar envio de mensagem:', error);
        res.status(500).json({ success: false, message: `Erro ao enviar mensagem: ${error.message}` });
    }
});

// Rota para limpar mensagens
app.get('/api/clear-messages', (req, res) => {
    try {
        const { deviceId } = req.query;
        
        messageStore.clearMessages(deviceId);
        
        if (deviceId) {
            console.log(`Mensagens do dispositivo ${deviceId} removidas com sucesso`);
            res.json({ success: true, message: `Mensagens do dispositivo removidas com sucesso` });
        } else {
            console.log('Todas as mensagens removidas com sucesso');
            res.json({ success: true, message: 'Todas as mensagens removidas com sucesso' });
        }
    } catch (error) {
        console.error('Erro ao limpar mensagens:', error);
        res.status(500).json({ success: false, message: 'Erro ao limpar mensagens' });
    }
});

// API para histórico de mensagens
app.get('/api/messages', (req, res) => {
    try {
        const { deviceId, limit } = req.query;
        console.log(`Solicitação de mensagens para dispositivo ${deviceId || 'todos'}, limite: ${limit || 'padrão'}`);
        
        let messages = [];
        
        if (deviceId) {
            console.log(`Buscando mensagens para o dispositivo ${deviceId}`);
            messages = messageStore.getMessages(deviceId, limit ? parseInt(limit) : 50);
            console.log(`Recuperadas ${messages.length} mensagens para o dispositivo ${deviceId}`);
            
            // Debug: exibir as mensagens recuperadas
            if (messages.length > 0) {
                console.log('Primeira mensagem:', JSON.stringify(messages[0]));
            } else {
                console.log('Nenhuma mensagem encontrada para este dispositivo');
            }
        } else {
            messages = messageStore.getMessages(null, limit ? parseInt(limit) : 100);
            console.log(`Recuperadas ${messages.length} mensagens de todos os dispositivos`);
        }
        
        // Adicionar timestamp para mensagens que não têm
        messages = messages.map(msg => {
            if (!msg.timestamp) {
                msg.timestamp = new Date().toISOString();
            }
            return msg;
        });
        
        res.json(messages);
    } catch (error) {
        console.error('Erro ao recuperar mensagens:', error);
        res.status(500).json({ success: false, message: 'Erro ao recuperar mensagens' });
    }
});

// Rota para adicionar mensagem de teste (apenas para depuração)
app.get('/api/test-message', (req, res) => {
    try {
        const { deviceId } = req.query;
        
        if (!deviceId) {
            return res.status(400).json({ success: false, message: 'Dispositivo é obrigatório' });
        }
        
        // Verificar se o dispositivo existe
        const device = db.devices.getDeviceById(deviceId);
        if (!device) {
            return res.status(404).json({ success: false, message: 'Dispositivo não encontrado' });
        }
        
        // Adicionar mensagem de teste
        const messageId = db.messages.addMessage(
            deviceId,
            'incoming',
            '5511999999999@s.whatsapp.net',
            device.phone || 'unknown',
            'Esta é uma mensagem de teste para depuração'
        );
        
        if (!messageId) {
            return res.status(500).json({ success: false, message: 'Erro ao adicionar mensagem de teste' });
        }
        
        console.log(`Mensagem de teste adicionada com ID ${messageId}`);
        res.json({ success: true, messageId });
    } catch (error) {
        console.error('Erro ao adicionar mensagem de teste:', error);
        res.status(500).json({ success: false, message: 'Erro ao adicionar mensagem de teste' });
    }
});

// Socket.io para comunicação em tempo real
io.on('connection', (socket) => {
    console.log('Cliente conectado');
    
    // Enviar lista de dispositivos e seus status
    const devices = db.devices.getAllDevices();
    devices.forEach(device => {
        const connection = connections[device.id];
        if (connection) {
            socket.emit('device-status', { 
                deviceId: device.id, 
                connected: connection.isConnected 
            });
            
            if (connection.qrCode && !connection.isConnected) {
                socket.emit('device-qr', { 
                    deviceId: device.id, 
                    qrCode: connection.qrCode 
                });
            }
        }
    });
    
    // Evento para reconectar dispositivo
    socket.on('reconnect-device', async (data) => {
        const { deviceId } = data;
        const device = db.devices.getDeviceById(deviceId);
        
        if (device) {
            if (connections[deviceId]) {
                // Se já existe uma conexão, tenta desconectar primeiro
                if (connections[deviceId].isConnected) {
                    await connections[deviceId].socket.logout();
                }
                delete connections[deviceId];
            }
            
            // Iniciar nova conexão
            connectToWhatsApp(deviceId, device.name);
        }
    });
    
    // Evento para desconectar dispositivo
    socket.on('disconnect-device', async (data) => {
        const { deviceId } = data;
        
        if (connections[deviceId] && connections[deviceId].isConnected) {
            await connections[deviceId].socket.logout();
            connections[deviceId].isConnected = false;
            
            // Atualizar status no banco de dados
            db.devices.updateDeviceStatus(deviceId, 'disconnected');
            
            // Emitir evento para todos os clientes
            io.emit('device-status', { deviceId, connected: false });
        }
    });
    
    socket.on('disconnect', () => {
        console.log('Cliente desconectado');
    });
});

// Função para inicializar dispositivos existentes
async function initializeExistingDevices() {
    try {
        console.log('Inicializando dispositivos existentes...');
        const devices = db.devices.getAllDevices();
        
        if (devices.length === 0) {
            console.log('Nenhum dispositivo encontrado para inicializar');
            return;
        }
        
        console.log(`Encontrados ${devices.length} dispositivos para inicializar`);
        
        for (const device of devices) {
            try {
                console.log(`Inicializando dispositivo ${device.id} (${device.name})`);
                await connectToWhatsApp(device.id, device.name);
            } catch (error) {
                console.error(`Erro ao inicializar dispositivo ${device.id} (${device.name}):`, error);
            }
        }
        
        console.log('Inicialização de dispositivos concluída');
    } catch (error) {
        console.error('Erro ao inicializar dispositivos existentes:', error);
    }
}

// Iniciar servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    // Iniciar conexões para dispositivos existentes
    initializeExistingDevices();
});