// estado global
let sensores = []
let filtroModoAtivo = 'todos'
let filtroTipoAtivo = 'todos'

const STATUS_LABEL = { ok: '✓ OK', alerta: '⚠ Alerta', erro: '✕ Erro' }
const FALHA_LABEL  = {
    '':              'Sem falha',
    'variacao':      'Variação',
    'erro_deteccao': 'Erro de detecção',
    'sem_resposta':  'Sem resposta'
}

// init
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('grupo-faixa-temp')) toggleTipo()
    if (document.getElementById('sensor-grid'))      carregarSensores()
})

// pag criacao
function toggleTipo() {
    const tipo = document.getElementById('select-tipo')?.value
    if (!tipo) return
    document.getElementById('grupo-faixa-temp').classList.toggle('hidden', tipo !== 'temp')
    document.getElementById('grupo-faixa-umid').classList.toggle('hidden', tipo !== 'umid')
}

async function criarSensor() {
    const tipo  = document.getElementById('select-tipo')?.value
    const modo  = document.getElementById('select-modo')?.value
    const falha = document.getElementById('select-falha')?.value || null

    const min_val = tipo === 'temp' ? document.getElementById('f-min-temp').value
                                    : document.getElementById('f-min-umid').value
    const max_val = tipo === 'temp' ? document.getElementById('f-max-temp').value
                                    : document.getElementById('f-max-umid').value

    if (!min_val || !max_val) { showFeedback('Preencha todas as faixas.', 'erro'); return }
    if (parseFloat(min_val) >= parseFloat(max_val)) { showFeedback('O mínimo deve ser menor que o máximo.', 'erro'); return }

    try {
        const res = await fetch('/api/sensores', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tipo, modo, min_val: parseFloat(min_val), max_val: parseFloat(max_val), falha: falha || null })
        })
        if (!res.ok) throw new Error()
        const sensor = await res.json()
        showFeedback(`${sensor.nome} criado! Valor inicial: ${sensor.ultimo_valor !== null ? sensor.ultimo_valor + (tipo === 'temp' ? '°C' : '%') : '—'}`, 'ok')
        document.getElementById('f-min-temp').value = ''
        document.getElementById('f-max-temp').value = ''
        document.getElementById('f-min-umid').value = ''
        document.getElementById('f-max-umid').value = ''
        document.getElementById('select-falha').value = ''
    } catch { showFeedback('Erro ao criar sensor.', 'erro') }
}

function showFeedback(msg, tipo) {
    const el = document.getElementById('feedback')
    if (!el) return
    el.textContent = msg
    el.className = `feedback ${tipo}`
    setTimeout(() => { el.className = 'feedback hidden' }, 4000)
}

// modal acoes rapidas
function abrirModal() {
    document.getElementById('modal-overlay').classList.remove('hidden')
    carregarStatusScheduler()
}

function fecharModal() {
    document.getElementById('modal-overlay').classList.add('hidden')
}

function fecharModalOverlay(e) {
    if (e.target === document.getElementById('modal-overlay')) fecharModal()
}

async function carregarStatusScheduler() {
    try {
        const res  = await fetch('/api/scheduler/status')
        const data = await res.json()
        const el   = document.getElementById('scheduler-info')
        if (!el) return
        const proxima = data.proxima_leitura
            ? new Date(data.proxima_leitura).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit' })
            : '—'
        const ultima = data.ultima_leitura
            ? `${data.ultima_leitura.clima?.temperatura ?? '—'}°C / ${data.ultima_leitura.clima?.umidade ?? '—'}% às ${new Date(data.ultima_leitura.ts).toLocaleString('pt-BR', { hour:'2-digit', minute:'2-digit' })}`
            : 'Nenhuma ainda'
        el.innerHTML = `
            <div class="sched-row"><span>Próxima leitura</span><strong>${proxima}</strong></div>
            <div class="sched-row"><span>Última leitura</span><strong>${ultima}</strong></div>
            <div class="sched-row"><span>Leituras hoje</span><strong>${data.total_hoje}</strong></div>
        `
    } catch { /* silencioso */ }
}

// irrigação global (modal) — registra para todos
async function registrarIrrigacao() {
    try {
        const res  = await fetch('/api/irrigacao', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        })
        const data = await res.json()
        let msg = '💧 Irrigação registrada!'
        if (data.alertas_umidade?.length > 0) {
            msg += ` ⚠ Atenção: ${data.alertas_umidade.length} sensor(es) com umidade abaixo do esperado.`
        }
        mostrarFbModal('fb-irrigacao', msg, data.alertas_umidade?.length > 0 ? 'alerta' : 'ok')
        if (document.getElementById('sensor-grid')) await carregarSensores()
    } catch { mostrarFbModal('fb-irrigacao', 'Erro ao registrar.', 'erro') }
}

// temperatura estufa global (modal)
async function registrarTempEstufa() {
    const val = document.getElementById('estufa-temp')?.value
    if (!val) { mostrarFbModal('fb-estufa', 'Informe a temperatura.', 'erro'); return }
    try {
        const res  = await fetch('/api/estufa/temperatura', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ valor: parseFloat(val) })
        })
        const data = await res.json()
        const n    = data.atualizados?.length || 0
        if (n === 0) {
            mostrarFbModal('fb-estufa', 'Nenhum sensor de temperatura da estufa encontrado.', 'alerta')
        } else {
            mostrarFbModal('fb-estufa', `🌡 ${n} sensor(es) atualizado(s) com ${val}°C`, 'ok')
            document.getElementById('estufa-temp').value = ''
            if (document.getElementById('sensor-grid')) await carregarSensores()
        }
    } catch { mostrarFbModal('fb-estufa', 'Erro ao atualizar.', 'erro') }
}

function mostrarFbModal(id, msg, tipo) {
    const el = document.getElementById(id)
    if (!el) return
    el.textContent = msg
    el.className = `modal-feedback ${tipo}`
    setTimeout(() => { el.className = 'modal-feedback hidden' }, 5000)
}

// pag gerenciar
async function carregarSensores() {
    try {
        const res = await fetch('/api/sensores')
        sensores  = await res.json()
        renderGrid()
        renderStats()
    } catch(e) { console.error('Erro ao carregar sensores:', e) }
}

function filtrarModo(modo, btn) {
    filtroModoAtivo = modo
    btn.closest('.filtro-grupo').querySelectorAll('.filtro-btn').forEach(b => b.classList.remove('ativo'))
    btn.classList.add('ativo')
    renderGrid()
}

function filtrarTipo(tipo, btn) {
    filtroTipoAtivo = tipo
    btn.closest('.filtro-grupo').querySelectorAll('.filtro-btn').forEach(b => b.classList.remove('ativo'))
    btn.classList.add('ativo')
    renderGrid()
}

function renderStats() {
    const bar = document.getElementById('stats-bar')
    if (!bar) return
    const ok     = sensores.filter(s => s.status_atual === 'ok').length
    const alerta = sensores.filter(s => s.status_atual === 'alerta').length
    const erro   = sensores.filter(s => s.status_atual === 'erro').length
    bar.innerHTML = `
        <span class="stat ok">${ok} ok</span>
        <span class="stat alerta">${alerta} alerta</span>
        <span class="stat erro">${erro} erro</span>
    `
}

function renderGrid() {
    const grid  = document.getElementById('sensor-grid')
    const empty = document.getElementById('empty-state')
    if (!grid) return

    let lista = sensores
    if (filtroModoAtivo !== 'todos') lista = lista.filter(s => s.modo === filtroModoAtivo)
    if (filtroTipoAtivo !== 'todos') lista = lista.filter(s => s.tipo === filtroTipoAtivo)

    grid.innerHTML = ''
    if (lista.length === 0) { if (empty) empty.classList.remove('hidden'); return }
    if (empty) empty.classList.add('hidden')

    lista.forEach((s, i) => {
        const card = criarCard(s)
        card.style.animationDelay = `${i * 0.05}s`
        grid.appendChild(card)
    })
}

function criarCard(s) {
    const unidade = s.tipo === 'temp' ? '°C' : '%'
    const status  = s.status_atual || 'ok'
    const valor   = (s.ultimo_valor !== null && s.ultimo_valor !== undefined)
        ? `${s.ultimo_valor}${unidade}` : '—'

    const div = document.createElement('div')
    div.className = `card status-${status}`
    div.innerHTML = `
        <div class="card-top">
            <span class="card-id">${s.id}</span>
            <div style="display:flex;align-items:center;gap:8px">
                <span class="card-modo">${s.modo === 'estufa' ? '🏠' : '🌿'}</span>
                <button class="btn-deletar" title="Excluir sensor" onclick="deletarSensor(event, '${s.id}')">✕</button>
            </div>
        </div>
        <div class="card-nome">${s.nome}</div>
        <div class="card-tipo">${s.tipo === 'temp' ? '🌡 TEMPERATURA' : '💧 UMIDADE'}</div>
        <div class="card-valor">${valor}</div>
        <div class="card-faixa">${s.min_val}${unidade} — ${s.max_val}${unidade}</div>
        <div class="card-footer">
            <span class="status-pill ${status}">${STATUS_LABEL[status] || status}</span>
            <span class="card-ts">${s.ultima_leitura ? formatTs(s.ultima_leitura) : '—'}</span>
        </div>
    `
    div.addEventListener('click', () => abrirDetalhe(s.id))
    return div
}

async function deletarSensor(e, id, deDetalhe = false) {
    e.stopPropagation()
    if (!confirm(`Excluir sensor ${id}? Esta ação não pode ser desfeita.`)) return
    try {
        const res = await fetch(`/api/sensores/${encodeURIComponent(id)}`, { method: 'DELETE' })
        if (!res.ok) throw new Error()
        sensores = sensores.filter(s => s.id !== id)
        if (deDetalhe) voltarGrid()
        renderGrid()
        renderStats()
    } catch { alert('Erro ao excluir sensor.') }
}

// leitura geral toolbar
async function leituraGeral() {
    const btn = document.querySelector('.btn-leitura-geral')
    if (btn) { btn.textContent = 'Atualizando...'; btn.disabled = true }
    try {
        for (const s of sensores) {
            if (s.modo === 'externo' || (s.modo === 'estufa' && s.tipo === 'umid')) {
                await fetch(`/api/sensores/${encodeURIComponent(s.id)}/leitura`, { method: 'POST' })
            }
        }
        await carregarSensores()
    } finally {
        if (btn) { btn.textContent = 'Realizar leitura'; btn.disabled = false }
    }
}

// leitura manual sensor externo
async function leituraManual(id) {
    try {
        const res = await fetch(`/api/sensores/${encodeURIComponent(id)}/leitura`, { method: 'POST' })
        if (!res.ok) {
            const err = await res.json()
            alert(err.erro || 'Erro ao realizar leitura.')
            return
        }
        await abrirDetalhe(id)
    } catch { alert('Erro ao realizar leitura.') }
}

// irrigação de um sensor específico
async function irrigacaoSensor(id) {
    try {
        await fetch(`/api/sensores/${encodeURIComponent(id)}/irrigacao`, { method: 'POST' })
        await abrirDetalhe(id)
    } catch { alert('Erro ao registrar irrigação.') }
}

// temperatura de um sensor específico
async function tempSensor(id) {
    const input = document.getElementById('temp-inline-input')
    const val = input?.value
    if (!val) { alert('Informe a temperatura.'); return }
    try {
        await fetch(`/api/sensores/${encodeURIComponent(id)}/temperatura`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ valor: parseFloat(val) })
        })
        await abrirDetalhe(id)
    } catch { alert('Erro ao registrar temperatura.') }
}

// detalhe sensor
function atualizarHeaderDetalhe() {
    const header = document.getElementById('header-principal')
    if (!header) return
    header.innerHTML = `
        <a href="/" class="logo">⬡ SensorGrid</a>
        <nav>
            <a href="/" class="nav-link">Criar Sensor</a>
            <a href="/gerenciar" class="nav-link ativo">Gerenciar</a>
            <button class="btn-acoes" onclick="abrirModal()">Ações rápidas</button>
        </nav>
    `
}

function restaurarHeader() {
    const header = document.getElementById('header-principal')
    if (!header) return
    header.innerHTML = `
        <a href="/" class="logo">⬡ SensorGrid</a>
        <nav>
            <a href="/" class="nav-link">Criar Sensor</a>
            <a href="/gerenciar" class="nav-link ativo">Gerenciar</a>
            <button class="btn-acoes" onclick="abrirModal()">Ações rápidas</button>
        </nav>
    `
}

async function abrirDetalhe(id) {
    try {
        const res = await fetch(`/api/sensores/${encodeURIComponent(id)}`)
        const s   = await res.json()

        document.getElementById('view-grid').classList.add('hidden')
        const view = document.getElementById('view-detalhe')
        view.classList.remove('hidden')
        atualizarHeaderDetalhe()

        const unidade = s.tipo === 'temp' ? '°C' : '%'
        const status  = s.status_atual || 'ok'

        const logHTML = s.log && s.log.length
            ? [...s.log].reverse().map(l => `
                <div class="log-item ${l.status}">
                    <span class="log-ts">${formatTs(l.ts)}</span>
                    <span class="log-msg">Status mudou para <strong>${STATUS_LABEL[l.status] || l.status}</strong>${l.origem === 'manual' ? ' <em>(manual)</em>' : ''}</span>
                    <span class="log-val">${l.valor !== null ? l.valor + unidade : '—'}</span>
                </div>`).join('')
            : '<p class="sem-dados">Nenhum evento registrado ainda.</p>'

        const histHTML = s.historico && s.historico.length
            ? [...s.historico].slice(-10).reverse().map(h => `
                <div class="log-item ${h.status}">
                    <span class="log-ts">${formatTs(h.ts)}</span>
                    <span class="log-origem">${h.origem === 'manual' ? '✎' : '⟳'}</span>
                    <span class="log-val">${h.valor !== null ? h.valor + unidade : '—'}</span>
                </div>`).join('')
            : '<p class="sem-dados">Sem leituras ainda.</p>'

        // botão contextual por tipo/modo
        let btnAcao = ''
        if (s.modo === 'externo') {
            btnAcao = `<button class="btn-leitura" onclick="leituraManual('${s.id}')">Realizar leitura</button>`
        } else if (s.modo === 'estufa' && s.tipo === 'umid') {
            btnAcao = `<button class="btn-leitura" onclick="irrigacaoSensor('${s.id}')">💧 Registrar irrigação</button>`
        } else if (s.modo === 'estufa' && s.tipo === 'temp') {
            btnAcao = `
                <div style="display:flex;align-items:center;gap:6px">
                    <div class="input-wrap" style="width:110px">
                        <span class="input-label">°C</span>
                        <input type="number" id="temp-inline-input" placeholder="27" step="0.1"
                            style="width:100%;background:var(--bg3);border:1px solid var(--border2);border-radius:var(--radius);color:var(--text);padding:8px 10px 8px 34px;font-family:var(--mono);font-size:13px;outline:none;">
                    </div>
                    <button class="btn-leitura" onclick="tempSensor('${s.id}')">🌡 Registrar</button>
                </div>`
        }

        view.innerHTML = `
            <div class="detalhe-toolbar">
                <button class="btn-voltar" onclick="voltarGrid()">← Voltar</button>
                <div style="display:flex;align-items:center;gap:10px">
                    ${btnAcao}
                    <button class="btn-deletar-detalhe" onclick="deletarSensor(event, '${s.id}', true)">✕ Excluir</button>
                </div>
            </div>
            <div class="detalhe-wrap">
                <div class="detalhe-hero">
                    <div>
                        <div class="detalhe-id">${s.id}</div>
                        <h1 class="detalhe-nome">${s.nome}</h1>
                        <div class="detalhe-meta">
                            ${s.tipo === 'temp' ? '🌡 TEMPERATURA' : '💧 UMIDADE'} &nbsp;·&nbsp;
                            ${s.modo === 'estufa' ? '🏠 ESTUFA' : '🌿 EXTERNO'} &nbsp;·&nbsp;
                            criado ${formatTs(s.criado_em)}
                        </div>
                    </div>
                    <span class="status-pill ${status} grande">${STATUS_LABEL[status] || status}</span>
                </div>
                <div class="detalhe-grid">
                    <div class="painel">
                        <h3>Leitura atual</h3>
                        <div class="valor-grande ${status}">${s.ultimo_valor !== null ? s.ultimo_valor + unidade : '—'}</div>
                        <div class="info-lista">
                            <div class="info-row"><span>Faixa esperada</span><strong>${s.min_val}${unidade} — ${s.max_val}${unidade}</strong></div>
                            <div class="info-row"><span>Configuração</span><strong>${FALHA_LABEL[s.falha || ''] || 'Sem falha'}</strong></div>
                            <div class="info-row"><span>Total de leituras</span><strong>${s.historico ? s.historico.length : 0}</strong></div>
                            <div class="info-row"><span>Última leitura</span><strong>${s.ultima_leitura ? formatTs(s.ultima_leitura) : '—'}</strong></div>
                        </div>
                    </div>
                    <div class="painel">
                        <h3>Últimas leituras <span style="font-size:9px;color:var(--text3);margin-left:4px">⟳ auto &nbsp; ✎ manual</span></h3>
                        <div class="log-list">${histHTML}</div>
                    </div>
                    <div class="painel painel-full">
                        <h3>Log de eventos</h3>
                        <div class="log-list">${logHTML}</div>
                    </div>
                </div>
            </div>
        `
    } catch(e) { console.error('Erro ao abrir detalhe:', e) }
}

function voltarGrid() {
    document.getElementById('view-detalhe').classList.add('hidden')
    document.getElementById('view-grid').classList.remove('hidden')
    restaurarHeader()
}

function formatTs(ts) {
    return new Date(ts).toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit',
        hour: '2-digit', minute: '2-digit'
    })
}