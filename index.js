const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const fs = require('fs');
const pino = require('pino');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');

// Configuração do Express
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Pasta para armazenar as sessões
const SESSIONS_DIR = './sessions';
if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

// Servir arquivos estáticos
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Objeto para armazenar as conexões ativas
const connections = {};

// Função para iniciar a conexão com o WhatsApp
async function connectToWhatsApp(deviceId, deviceName) {
    // Criar pasta para a sessão específica do dispositivo
    const sessionDir = path.join(SESSIONS_DIR, deviceId);
    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
    }
    
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    
    // Configuração do logger
    const logger = pino({ level: 'silent' });
    
    // Criar conexão
    const sock = makeWASocket({
        printQRInTerminal: true,
        auth: state,
        logger
    });
    
    // Armazenar a conexão
    connections[deviceId] = {
        socket: sock,
        qrCode: '',
        isConnected: false,
        name: deviceName
    };
    
    // Evento de atualização de conexão
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            // Gerar QR code como string base64
            connections[deviceId].qrCode = await QRCode.toDataURL(qr);
            io.emit('device-qr', { deviceId, qrCode: connections[deviceId].qrCode });
            console.log(`QR Code gerado para dispositivo ${deviceId}`);
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
    sock.ev.on('creds.update', saveCreds);
    
    // Evento para receber mensagens
    sock.ev.on('messages.upsert', async (m) => {
        if (m.type === 'notify') {
            for (const msg of m.messages) {
                if (!msg.key.fromMe && msg.message) {
                    const sender = msg.key.remoteJid;
                    const messageContent = msg.message.conversation || 
                                          (msg.message.extendedTextMessage && msg.message.extendedTextMessage.text) || 
                                          (msg.message.imageMessage && msg.message.imageMessage.caption) || 
                                          'Mídia recebida';
                    
                    console.log(`Nova mensagem para ${deviceId} de ${sender}: ${messageContent}`);
                    
                    // Salvar mensagem no banco de dados
                    db.messages.addMessage(
                        deviceId,
                        'incoming',
                        sender,
                        sock.user.id,
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
            }
        }
    });
    
    return sock;
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

app.delete('/api/devices/:id', (req, res) => {
    const { id } = req.params;
    
    // Verificar se o dispositivo existe
    const device = db.devices.getDeviceById(id);
    if (!device) {
        return res.status(404).json({ success: false, message: 'Dispositivo não encontrado' });
    }
    
    // Desconectar se estiver conectado
    if (connections[id]) {
        if (connections[id].isConnected) {
            connections[id].socket.logout();
        }
        delete connections[id];
    }
    
    // Remover pasta da sessão
    const sessionDir = path.join(SESSIONS_DIR, id);
    if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
    }
    
    // Remover do banco de dados
    db.devices.removeDevice(id);
    
    res.json({ success: true, message: 'Dispositivo removido com sucesso' });
});

app.get('/api/devices/:id/qrcode', (req, res) => {
    const { id } = req.params;
    
    // Verificar se o dispositivo existe
    const device = db.devices.getDeviceById(id);
    if (!device) {
        return res.status(404).json({ success: false, message: 'Dispositivo não encontrado' });
    }
    
    // Verificar se há QR code disponível
    if (connections[id] && connections[id].qrCode && !connections[id].isConnected) {
        res.json({ qrcode: connections[id].qrCode });
    } else {
        res.status(404).json({ message: 'QR Code não disponível' });
    }
});

// Rota para enviar mensagem
app.post('/api/send-message', async (req, res) => {
    try {
        const { deviceId, number, message } = req.body;
        
        if (!deviceId || !number || !message) {
            return res.status(400).json({ 
                success: false, 
                message: 'Dispositivo, número e mensagem são obrigatórios' 
            });
        }
        
        // Verificar se o dispositivo existe e está conectado
        if (!connections[deviceId] || !connections[deviceId].isConnected) {
            return res.status(400).json({ 
                success: false, 
                message: 'Dispositivo não está conectado' 
            });
        }
        
        // Formatar número (adicionar @s.whatsapp.net)
        const formattedNumber = number.includes('@s.whatsapp.net') 
            ? number 
            : `${number.replace(/[^\d]/g, '')}@s.whatsapp.net`;
        
        // Enviar mensagem
        await connections[deviceId].socket.sendMessage(formattedNumber, { text: message });
        
        // Salvar mensagem no banco de dados
        db.messages.addMessage(
            deviceId,
            'outgoing',
            connections[deviceId].socket.user.id,
            formattedNumber,
            message
        );
        
        res.json({ success: true, message: 'Mensagem enviada com sucesso' });
    } catch (error) {
        console.error('Erro ao enviar mensagem:', error);
        res.status(500).json({ success: false, message: 'Erro ao enviar mensagem' });
    }
});

// API para histórico de mensagens
app.get('/api/messages', (req, res) => {
    const { deviceId, limit } = req.query;
    let messages;
    
    if (deviceId) {
        messages = db.messages.getMessagesByDevice(deviceId, limit ? parseInt(limit) : 50);
    } else {
        messages = db.messages.getAllMessages(limit ? parseInt(limit) : 100);
    }
    
    res.json(messages);
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

// Iniciar conexões para dispositivos existentes
async function initializeExistingDevices() {
    const devices = db.devices.getAllDevices();
    for (const device of devices) {
        await connectToWhatsApp(device.id, device.name);
    }
}

// Iniciar servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    // Iniciar conexões para dispositivos existentes
    initializeExistingDevices();
});