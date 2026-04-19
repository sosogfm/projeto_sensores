// Estado global 
let modoAtivo = localStorage.getItem('modo') || 'externo'
let sensores = []

// Init 
document.addEventListener('DOMContentLoaded', () => {
    aplicarModo(modoAtivo)

    if (document.getElementById('sensor-grid')) {
        carregarSensores()
    }
    if (document.getElementById('historico-irrigacao')) {
        carregarIrrigacao()
    }
})

// Modo estufa / externo 
function trocarModo(modo) {
    modoAtivo = modo
    localStorage.setItem('modo', modo)
    aplicarModo(modo)
    if (document.getElementById('sensor-grid')) {
        renderGrid()
    }
}

function aplicarModo(modo) {
    document.documentElement.setAttribute('data-modo', modo)
    document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('ativo'))
    const btn = document.getElementById(`btn-${modo}`)
    if (btn) btn.classList.add('ativo')
}

// Carregar sensores 
async function carregarSensores() {
    const res = await fetch('/api/sensores')
    sensores = await res.json()
    renderGrid()
}

//Renderizar grid 
function renderGrid() {
    const grid = document.getElementById('sensor-grid')
    const empty = document.getElementById('empty-state')
    if (!grid) return

    const filtrados = sensores.filter(s => s.modo === modoAtivo)
    grid.innerHTML = ''

    if (filtrados.length === 0) {
        empty.classList.remove('hidden')
        return
    }
    empty.classList.add('hidden')

    filtrados.forEach(s => {
        const card = criarCard(s)
        grid.appendChild(card)
    })
}

// Criar card 
function criarCard(s) {
    const unidade = s.tipo === 'temp' ? '°C' : '%'
    const valor = s.ultimo_valor !== null ? `${s.ultimo_valor}${unidade}` : '—'
    const status = s.status_atual || 'ok'

    const div = document.createElement('div')
    div.className = `card status-${status}`
    div.innerHTML = `
        <div class="card-id">${s.id}</div>
        <div class="card-nome">${s.nome}</div>
        <div class="card-tipo">${s.tipo === 'temp' ? '🌡 Temperatura' : '💧 Umidade'}</div>
        <div class="card-valor">${valor}</div>
        <div class="card-faixa">${s.min_val}${unidade} — ${s.max_val}${unidade}</div>
        <div class="status-pill ${status}">${statusLabel(status)}</div>
    `
    div.addEventListener('click', () => abrirDetalhe(s.id))
    return div
}

function statusLabel(s) {
    return { ok: '✓ OK', alerta: '⚠ Alerta', erro: '✕ Erro' }[s] || s
}

// Detalhe do sensor
async function abrirDetalhe(id) {
    const res = await fetch(`/api/sensores/${id}`)
    const s = await res.json()

    document.getElementById('view-grid').classList.add('hidden')
    const detalhe = document.getElementById('view-detalhe')
    detalhe.classList.remove('hidden')

    const unidade = s.tipo === 'temp' ? '°C' : '%'
    const logHTML = s.log.length
        ? [...s.log].reverse().map(l => `
            <div class="log-item ${l.status}">
                <span class="log-ts">${formatTs(l.ts)}</span>
                <span>Status: <strong>${statusLabel(l.status)}</strong></span>
                <span>${l.valor !== null ? l.valor + unidade : '—'}</span>
            </div>`).join('')
        : '<p>Sem eventos ainda.</p>'

    detalhe.innerHTML = `
        <header>
            <span class="logo">SensorGrid</span>
            <nav>
                <button class="btn-voltar" onclick="voltarGrid()">← Voltar</button>
            </nav>
        </header>
        <div class="container-detalhe">
            <div class="detalhe-topo">
                <div>
                    <h1>${s.nome}</h1>
                    <small>${s.id} · ${s.tipo === 'temp' ? 'Temperatura' : 'Umidade'} · ${s.modo}</small>
                </div>
                <span class="status-pill ${s.status_atual}">${statusLabel(s.status_atual)}</span>
            </div>
            <div class="detalhe-grid">
                <div class="painel">
                    <h3>Leitura atual</h3>
                    <div class="valor-grande">${s.ultimo_valor !== null ? s.ultimo_valor + unidade : '—'}</div>
                    <p>Faixa: ${s.min_val}${unidade} — ${s.max_val}${unidade}</p>
                    <p>Falha configurada: ${s.falha || 'Nenhuma'}</p>
                    <p>Última leitura: ${s.ultima_leitura ? formatTs(s.ultima_leitura) : '—'}</p>
                </div>
                <div class="painel">
                    <h3>Log de eventos</h3>
                    <div class="log-list">${logHTML}</div>
                </div>
            </div>
        </div>
    `
}

function voltarGrid() {
    document.getElementById('view-detalhe').classList.add('hidden')
    document.getElementById('view-grid').classList.remove('hidden')
}

//Criar sensor (gerenciar.html)
function toggleCamposTipo() {
    const tipo = document.getElementById('f-tipo').value
    document.getElementById('campos-temp').classList.toggle('hidden', tipo !== 'temp')
    document.getElementById('campos-umid').classList.toggle('hidden', tipo !== 'umid')
}

async function criarSensor() {
    const tipo = document.getElementById('f-tipo').value
    const modo = document.getElementById('f-modo').value
    const falha = document.getElementById('f-falha').value || null
    const min_val = tipo === 'temp'
        ? document.getElementById('f-min').value
        : document.getElementById('f-min-u').value
    const max_val = tipo === 'temp'
        ? document.getElementById('f-max').value
        : document.getElementById('f-max-u').value

    if (!min_val || !max_val) {
        mostrarFeedback('Preencha a faixa esperada.', 'erro')
        return
    }
    if (parseFloat(min_val) >= parseFloat(max_val)) {
        mostrarFeedback('O mínimo deve ser menor que o máximo.', 'erro')
        return
    }

    const res = await fetch('/api/sensores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo, modo, min_val, max_val, falha })
    })
    const sensor = await res.json()
    mostrarFeedback(`${sensor.nome} criado com sucesso!`, 'ok')
}

function mostrarFeedback(msg, tipo) {
    const el = document.getElementById('feedback-sensor')
    el.textContent = msg
    el.className = `feedback ${tipo}`
}

// Irrigação

async function registrarIrrigacao() {
    await fetch('/api/irrigacao', { method: 'POST' })
    carregarIrrigacao()
}

async function carregarIrrigacao() {
    const res = await fetch('/api/irrigacao')
    const lista = await res.json()
    const el = document.getElementById('historico-irrigacao')
    if (!el) return
    el.innerHTML = lista.length
        ? [...lista].reverse().map(i => `
            <div class="log-item ok">
                <span class="log-ts">${formatTs(i.ts)}</span>
                <span>💧 Irrigação registrada</span>
            </div>`).join('')
        : '<p>Nenhuma irrigação registrada.</p>'
}

// Helpers 

function formatTs(ts) {
    return new Date(ts).toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit',
        hour: '2-digit', minute: '2-digit'
    })
}