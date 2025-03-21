document.addEventListener('DOMContentLoaded', function() {
    // Verificar autenticação
    const currentPath = window.location.pathname;
    if (localStorage.getItem('authenticated') !== 'true' && currentPath !== '/') {
        window.location.href = '/';
        return;
    }

    // Elementos DOM - Dispositivos
    const deviceList = document.getElementById('device-list');
    const deviceDetails = document.getElementById('device-details');
    const welcomeMessage = document.getElementById('welcome-message');
    const deviceName = document.getElementById('device-name');
    const devicePhone = document.getElementById('device-phone');
    const deviceStatusBadge = document.getElementById('device-status-badge');
    const qrcodeContainer = document.getElementById('qrcode-container');
    const qrcodeElement = document.getElementById('qrcode');
    const reconnectBtn = document.getElementById('reconnect-btn');
    const disconnectBtn = document.getElementById('disconnect-btn');
    const removeDeviceBtn = document.getElementById('remove-device-btn');
    
    // Elementos DOM - Formulários
    const addDeviceForm = document.getElementById('add-device-form');
    const deviceNameInput = document.getElementById('device-name-input');
    const saveDeviceBtn = document.getElementById('save-device-btn');
    const addDeviceModal = new bootstrap.Modal(document.getElementById('addDeviceModal'));
    const confirmModal = new bootstrap.Modal(document.getElementById('confirmModal'));
    const confirmTitle = document.getElementById('confirm-title');
    const confirmMessage = document.getElementById('confirm-message');
    const confirmActionBtn = document.getElementById('confirm-action-btn');
    
    // Elementos DOM - Mensagens
    const messageForm = document.getElementById('message-form');
    const selectedDeviceId = document.getElementById('selected-device-id');
    const numberInput = document.getElementById('number');
    const messageInput = document.getElementById('message');
    const sendBtn = document.getElementById('send-btn');
    const messageHistory = document.getElementById('message-history');
    const clearHistoryBtn = document.getElementById('clear-history');
    const refreshHistoryBtn = document.getElementById('refresh-history');

    // Conectar ao Socket.io
    const socket = io({
        path: '/socket.io/',
        transports: ['polling', 'websocket'],
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
        timeout: 60000,
        forceNew: true,
        upgrade: true,
        rejectUnauthorized: false
    });
    
    // Adicionar handlers de eventos para conexão
    socket.on('connect', () => {
        console.log('Socket conectado');
    });
    
    socket.on('connect_error', (error) => {
        console.error('Erro de conexão:', error);
    });
    
    // Dispositivo selecionado atualmente
    let currentDeviceId = null;
    
    // Mapa de dispositivos
    const devices = new Map();

    // Carregar lista de dispositivos
    function loadDevices() {
        fetch('/api/devices')
            .then(res => res.json())
            .then(data => {
                // Limpar lista atual
                deviceList.innerHTML = '';
                devices.clear();
                
                if (data.length === 0) {
                    deviceList.innerHTML = '<li class="list-group-item text-center text-muted">Nenhum dispositivo cadastrado</li>';
                    return;
                }
                
                // Adicionar dispositivos à lista
                data.forEach(device => {
                    devices.set(device.id, device);
                    addDeviceToList(device);
                });
                
                // Se tiver um dispositivo selecionado, manter a seleção
                if (currentDeviceId && devices.has(currentDeviceId)) {
                    selectDevice(currentDeviceId);
                }
            })
            .catch(err => {
                console.error('Erro ao carregar dispositivos:', err);
                showToast('Erro ao carregar dispositivos', 'danger');
            });
    }
    
    // Adicionar dispositivo à lista
    function addDeviceToList(device) {
        const item = document.createElement('li');
        item.className = 'list-group-item device-item d-flex justify-content-between align-items-center';
        item.dataset.deviceId = device.id;
        
        // Status do dispositivo
        let statusClass = 'status-waiting';
        let statusText = 'Aguardando';
        
        if (device.status === 'connected') {
            statusClass = 'status-connected';
            statusText = 'Conectado';
        } else if (device.status === 'disconnected') {
            statusClass = 'status-disconnected';
            statusText = 'Desconectado';
        }
        
        item.innerHTML = `
            <div>
                <div class="device-name">${device.name}</div>
                ${device.phone ? `<div class="device-phone">${formatPhoneNumber(device.phone)}</div>` : ''}
                <small class="device-status ${statusClass}">${statusText}</small>
            </div>
            <span class="badge rounded-pill ${device.status === 'connected' ? 'bg-success' : (device.status === 'disconnected' ? 'bg-danger' : 'bg-warning')}">
                <i class="bi ${device.status === 'connected' ? 'bi-phone' : (device.status === 'disconnected' ? 'bi-phone-x' : 'bi-hourglass-split')}"></i>
            </span>
        `;
        
        // Evento de clique para selecionar o dispositivo
        item.addEventListener('click', () => {
            selectDevice(device.id);
        });
        
        deviceList.appendChild(item);
    }
    
    // Selecionar dispositivo
    function selectDevice(deviceId) {
        // Remover seleção atual
        const activeItems = deviceList.querySelectorAll('.device-item.active');
        activeItems.forEach(item => item.classList.remove('active'));
        
        // Selecionar novo dispositivo
        const deviceItem = deviceList.querySelector(`.device-item[data-device-id="${deviceId}"]`);
        if (deviceItem) {
            deviceItem.classList.add('active');
        }
        
        currentDeviceId = deviceId;
        selectedDeviceId.value = deviceId;
        
        // Exibir detalhes do dispositivo
        const device = devices.get(deviceId);
        if (device) {
            deviceName.textContent = device.name;
            devicePhone.textContent = device.phone ? formatPhoneNumber(device.phone) : '';
            
            // Atualizar status
            updateDeviceStatusUI(device.status);
            
            // Verificar se há QR code disponível
            if (device.hasQrCode) {
                fetchQRCode(deviceId);
            }
            
            // Carregar histórico de mensagens
            loadMessageHistory(deviceId);
        }
        
        // Mostrar detalhes e ocultar mensagem de boas-vindas
        welcomeMessage.classList.add('d-none');
        deviceDetails.classList.remove('d-none');
    }
    
    // Atualizar UI de status do dispositivo
    function updateDeviceStatusUI(status) {
        if (status === 'connected') {
            deviceStatusBadge.className = 'badge bg-success';
            deviceStatusBadge.textContent = 'Conectado';
            qrcodeContainer.style.display = 'none';
            disconnectBtn.disabled = false;
            sendBtn.disabled = false;
        } else if (status === 'disconnected') {
            deviceStatusBadge.className = 'badge bg-danger';
            deviceStatusBadge.textContent = 'Desconectado';
            qrcodeContainer.style.display = 'block';
            disconnectBtn.disabled = true;
            sendBtn.disabled = true;
        } else {
            deviceStatusBadge.className = 'badge bg-warning';
            deviceStatusBadge.textContent = 'Aguardando';
            qrcodeContainer.style.display = 'block';
            disconnectBtn.disabled = true;
            sendBtn.disabled = true;
        }
    }
    
    // Buscar QR Code para um dispositivo
    function fetchQRCode(deviceId) {
        // Mostrar mensagem de carregamento
        qrcodeElement.innerHTML = '<div class="text-center"><div class="spinner-border text-success" role="status"></div><p class="mt-2">Gerando QR Code...</p></div>';
        
        fetch(`/api/devices/${deviceId}/qrcode`)
            .then(res => res.json())
            .then(data => {
                if (data.qrcode) {
                    qrcodeElement.innerHTML = '';
                    const img = document.createElement('img');
                    img.src = data.qrcode;
                    qrcodeElement.appendChild(img);
                } else if (data.connected) {
                    qrcodeElement.innerHTML = '<div class="alert alert-success">Dispositivo já está conectado!</div>';
                } else if (data.retry) {
                    // Se precisar tentar novamente, aguarda 3 segundos e tenta de novo
                    qrcodeElement.innerHTML = `<div class="text-center"><div class="spinner-border text-success" role="status"></div><p class="mt-2">${data.message}</p></div>`;
                    setTimeout(() => fetchQRCode(deviceId), 3000);
                } else {
                    qrcodeElement.innerHTML = '<div class="alert alert-warning">QR Code não disponível. Tente reconectar o dispositivo.</div>';
                }
            })
            .catch(err => {
                console.error('Erro ao obter QR Code:', err);
                qrcodeElement.innerHTML = '<div class="alert alert-danger">Erro ao obter QR Code. Tente novamente.</div>';
                
                // Tentar novamente após 5 segundos
                setTimeout(() => fetchQRCode(deviceId), 5000);
            });
    }
    
    // Adicionar novo dispositivo
    saveDeviceBtn.addEventListener('click', () => {
        const name = deviceNameInput.value.trim();
        
        if (!name) {
            alert('Por favor, informe um nome para o dispositivo');
            return;
        }
        
        fetch('/api/devices', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name })
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                // Limpar formulário e fechar modal
                deviceNameInput.value = '';
                addDeviceModal.hide();
                
                // Recarregar lista de dispositivos
                loadDevices();
                
                // Mostrar mensagem de sucesso
                showToast('Dispositivo adicionado com sucesso', 'success');
                
                // Selecionar o novo dispositivo
                setTimeout(() => {
                    selectDevice(data.deviceId);
                }, 500);
            } else {
                showToast(data.message || 'Erro ao adicionar dispositivo', 'danger');
            }
        })
        .catch(err => {
            console.error('Erro ao adicionar dispositivo:', err);
            showToast('Erro ao adicionar dispositivo', 'danger');
        });
    });
    
    // Reconectar dispositivo
    reconnectBtn.addEventListener('click', () => {
        if (!currentDeviceId) return;
        
        socket.emit('reconnect-device', { deviceId: currentDeviceId });
        showToast('Tentando reconectar...', 'info');
    });
    
    // Desconectar dispositivo
    disconnectBtn.addEventListener('click', () => {
        if (!currentDeviceId) return;
        
        showConfirmDialog(
            'Desconectar Dispositivo', 
            'Tem certeza que deseja desconectar este dispositivo do WhatsApp?',
            () => {
                socket.emit('disconnect-device', { deviceId: currentDeviceId });
                showToast('Dispositivo desconectado', 'warning');
            }
        );
    });
    
    // Remover dispositivo
    removeDeviceBtn.addEventListener('click', () => {
        if (!currentDeviceId) return;
        
        showConfirmDialog(
            'Remover Dispositivo', 
            'Tem certeza que deseja remover este dispositivo? Esta ação não pode ser desfeita.',
            () => {
                fetch(`/api/devices/${currentDeviceId}`, {
                    method: 'DELETE'
                })
                .then(res => res.json())
                .then(data => {
                    if (data.success) {
                        // Recarregar lista de dispositivos
                        loadDevices();
                        
                        // Ocultar detalhes e mostrar mensagem de boas-vindas
                        deviceDetails.classList.add('d-none');
                        welcomeMessage.classList.remove('d-none');
                        
                        // Limpar dispositivo atual
                        currentDeviceId = null;
                        
                        // Mostrar mensagem de sucesso
                        showToast('Dispositivo removido com sucesso', 'success');
                    } else {
                        showToast(data.message || 'Erro ao remover dispositivo', 'danger');
                    }
                })
                .catch(err => {
                    console.error('Erro ao remover dispositivo:', err);
                    showToast('Erro ao remover dispositivo', 'danger');
                });
            }
        );
    });
    
    // Enviar mensagem
    messageForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        if (!currentDeviceId) {
            showToast('Selecione um dispositivo primeiro', 'warning');
            return;
        }
        
        const number = numberInput.value.trim();
        const message = messageInput.value.trim();
        
        if (!number || !message) {
            showToast('Preencha todos os campos', 'warning');
            return;
        }
        
        try {
            sendBtn.disabled = true;
            sendBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Enviando...';
            
            const response = await fetch('/api/send-message', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    deviceId: currentDeviceId,
                    number, 
                    message 
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                // Limpar formulário
                messageInput.value = '';
                
                // Recarregar histórico
                loadMessageHistory(currentDeviceId);
                
                // Mostrar mensagem de sucesso
                showToast('Mensagem enviada com sucesso', 'success');
            } else {
                showToast(data.message || 'Erro ao enviar mensagem', 'danger');
            }
        } catch (error) {
            console.error('Erro ao enviar mensagem:', error);
            showToast('Erro ao enviar mensagem', 'danger');
        } finally {
            sendBtn.disabled = false;
            sendBtn.textContent = 'Enviar';
        }
    });
    
    // Carregar histórico de mensagens
    function loadMessageHistory(deviceId) {
        fetch(`/api/messages?deviceId=${deviceId}`)
            .then(res => res.json())
            .then(data => {
                messageHistory.innerHTML = '';
                
                if (data.length === 0) {
                    messageHistory.innerHTML = '<p class="text-center text-muted">Nenhuma mensagem recebida</p>';
                    return;
                }
                
                // Adicionar mensagens ao histórico
                data.forEach(msg => {
                    addMessageToHistory(msg);
                });
                
                // Rolar para o final
                messageHistory.scrollTop = messageHistory.scrollHeight;
            })
            .catch(err => {
                console.error('Erro ao carregar histórico de mensagens:', err);
                messageHistory.innerHTML = '<p class="text-center text-danger">Erro ao carregar mensagens</p>';
            });
    }
    
    // Atualizar histórico de mensagens
    refreshHistoryBtn.addEventListener('click', () => {
        if (currentDeviceId) {
            loadMessageHistory(currentDeviceId);
            showToast('Histórico atualizado', 'info');
        }
    });
    
    // Limpar histórico de mensagens
    clearHistoryBtn.addEventListener('click', () => {
        messageHistory.innerHTML = '<p class="text-center text-muted">Nenhuma mensagem recebida</p>';
    });
    
    // Adicionar mensagem ao histórico
    function addMessageToHistory(msg) {
        const messageItem = document.createElement('div');
        messageItem.className = 'message-item';
        
        // Determinar se é mensagem de entrada ou saída
        const isIncoming = msg.direction === 'incoming';
        
        // Formatar número de telefone para exibição
        let displaySender = isIncoming ? msg.sender : msg.recipient;
        displaySender = formatPhoneNumber(displaySender.split('@')[0]);
        
        // Formatar data
        const date = new Date(msg.timestamp);
        const formattedDate = `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
        
        messageItem.innerHTML = `
            <div class="d-flex justify-content-between align-items-start">
                <div class="sender">${isIncoming ? displaySender : 'Você para ' + displaySender}</div>
                <span class="badge ${isIncoming ? 'bg-primary' : 'bg-success'}">${isIncoming ? 'Recebida' : 'Enviada'}</span>
            </div>
            <div class="timestamp">${formattedDate}</div>
            <div class="content">${msg.content}</div>
        `;
        
        messageHistory.appendChild(messageItem);
    }
    
    // Formatar número de telefone
    function formatPhoneNumber(number) {
        if (!number) return '';
        
        // Remover caracteres não numéricos
        const cleaned = number.replace(/\D/g, '');
        
        // Verificar se é um número brasileiro
        if (cleaned.length >= 10 && cleaned.startsWith('55')) {
            const ddd = cleaned.substring(2, 4);
            const restante = cleaned.substring(4);
            
            if (restante.length === 9) {
                // Formato: +55 (11) 98765-4321
                return `+55 (${ddd}) ${restante.substring(0, 5)}-${restante.substring(5)}`;
            } else if (restante.length === 8) {
                // Formato: +55 (11) 8765-4321
                return `+55 (${ddd}) ${restante.substring(0, 4)}-${restante.substring(4)}`;
            }
        }
        
        // Se não for um número brasileiro ou não estiver no formato esperado
        return number;
    }
    
    // Mostrar diálogo de confirmação
    function showConfirmDialog(title, message, callback) {
        confirmTitle.textContent = title;
        confirmMessage.textContent = message;
        
        // Remover listeners antigos
        const newConfirmBtn = confirmActionBtn.cloneNode(true);
        confirmActionBtn.parentNode.replaceChild(newConfirmBtn, confirmActionBtn);
        
        // Adicionar novo listener
        newConfirmBtn.addEventListener('click', () => {
            confirmModal.hide();
            if (typeof callback === 'function') {
                callback();
            }
        });
        
        confirmModal.show();
    }
    
    // Mostrar toast de notificação
    function showToast(message, type = 'info') {
        // Verificar se já existe um container de toasts
        let toastContainer = document.querySelector('.toast-container');
        
        if (!toastContainer) {
            toastContainer = document.createElement('div');
            toastContainer.className = 'toast-container position-fixed bottom-0 end-0 p-3';
            document.body.appendChild(toastContainer);
        }
        
        // Criar toast
        const toastId = 'toast-' + Date.now();
        const toast = document.createElement('div');
        toast.className = `toast align-items-center text-white bg-${type} border-0`;
        toast.id = toastId;
        toast.setAttribute('role', 'alert');
        toast.setAttribute('aria-live', 'assertive');
        toast.setAttribute('aria-atomic', 'true');
        
        toast.innerHTML = `
            <div class="d-flex">
                <div class="toast-body">
                    ${message}
                </div>
                <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Fechar"></button>
            </div>
        `;
        
        toastContainer.appendChild(toast);
        
        // Inicializar e mostrar toast
        const bsToast = new bootstrap.Toast(toast, {
            autohide: true,
            delay: 3000
        });
        
        bsToast.show();
        
        // Remover após fechar
        toast.addEventListener('hidden.bs.toast', () => {
            toast.remove();
        });
    }
    
    // Eventos do Socket.io
    
    // Receber QR Code
    socket.on('device-qr', (data) => {
        const { deviceId, qrCode } = data;
        
        // Atualizar QR code se for o dispositivo atual
        if (currentDeviceId === deviceId) {
            qrcodeElement.innerHTML = '';
            const img = document.createElement('img');
            img.src = qrCode;
            qrcodeElement.appendChild(img);
            
            // Mostrar container do QR code
            qrcodeContainer.style.display = 'block';
        }
        
        // Atualizar status do dispositivo na lista
        const device = devices.get(deviceId);
        if (device) {
            device.hasQrCode = true;
            
            // Atualizar UI
            const deviceItem = deviceList.querySelector(`.device-item[data-device-id="${deviceId}"]`);
            if (deviceItem) {
                const statusElement = deviceItem.querySelector('.device-status');
                if (statusElement) {
                    statusElement.className = 'device-status status-waiting';
                    statusElement.textContent = 'Aguardando';
                }
                
                const badgeElement = deviceItem.querySelector('.badge');
                if (badgeElement) {
                    badgeElement.className = 'badge rounded-pill bg-warning';
                    badgeElement.innerHTML = '<i class="bi bi-hourglass-split"></i>';
                }
            }
        }
    });
    
    // Receber status do dispositivo
    socket.on('device-status', (data) => {
        const { deviceId, connected, phoneNumber } = data;
        
        // Atualizar status do dispositivo no mapa
        const device = devices.get(deviceId);
        if (device) {
            device.status = connected ? 'connected' : 'disconnected';
            if (phoneNumber) {
                device.phone = phoneNumber;
            }
            
            // Atualizar UI
            const deviceItem = deviceList.querySelector(`.device-item[data-device-id="${deviceId}"]`);
            if (deviceItem) {
                // Atualizar texto de status
                const statusElement = deviceItem.querySelector('.device-status');
                if (statusElement) {
                    statusElement.className = `device-status ${connected ? 'status-connected' : 'status-disconnected'}`;
                    statusElement.textContent = connected ? 'Conectado' : 'Desconectado';
                }
                
                // Atualizar badge
                const badgeElement = deviceItem.querySelector('.badge');
                if (badgeElement) {
                    badgeElement.className = `badge rounded-pill ${connected ? 'bg-success' : 'bg-danger'}`;
                    badgeElement.innerHTML = `<i class="bi ${connected ? 'bi-phone' : 'bi-phone-x'}"></i>`;
                }
                
                // Atualizar número de telefone se disponível
                if (phoneNumber) {
                    let phoneElement = deviceItem.querySelector('.device-phone');
                    if (!phoneElement) {
                        phoneElement = document.createElement('div');
                        phoneElement.className = 'device-phone';
                        deviceItem.querySelector('div').appendChild(phoneElement);
                    }
                    phoneElement.textContent = formatPhoneNumber(phoneNumber);
                }
            }
            
            // Atualizar detalhes se for o dispositivo atual
            if (currentDeviceId === deviceId) {
                updateDeviceStatusUI(device.status);
                if (phoneNumber) {
                    devicePhone.textContent = formatPhoneNumber(phoneNumber);
                }
            }
        }
    });
    
    // Receber nova mensagem
    socket.on('new-message', (data) => {
        const { deviceId, sender, message, timestamp } = data;
        
        // Adicionar ao histórico se for o dispositivo atual
        if (currentDeviceId === deviceId) {
            // Verificar se há a mensagem de "nenhuma mensagem"
            const emptyMessage = messageHistory.querySelector('.text-muted');
            if (emptyMessage) {
                messageHistory.innerHTML = '';
            }
            
            // Adicionar mensagem ao histórico
            const messageItem = document.createElement('div');
            messageItem.className = 'message-item';
            
            // Formatar número de telefone
            const displaySender = formatPhoneNumber(sender.split('@')[0]);
            
            // Formatar data
            const date = new Date(timestamp);
            const formattedDate = `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
            
            messageItem.innerHTML = `
                <div class="d-flex justify-content-between align-items-start">
                    <div class="sender">${displaySender}</div>
                    <span class="badge bg-primary">Recebida</span>
                </div>
                <div class="timestamp">${formattedDate}</div>
                <div class="content">${message}</div>
            `;
            
            messageHistory.appendChild(messageItem);
            messageHistory.scrollTop = messageHistory.scrollHeight;
            
            // Notificar usuário
            showToast(`Nova mensagem de ${displaySender}`, 'info');
        } else {
            // Notificar sobre mensagem em outro dispositivo
            const device = devices.get(deviceId);
            if (device) {
                showToast(`Nova mensagem para ${device.name}`, 'info');
            }
        }
    });
    
    // Inicialização
    loadDevices();
});