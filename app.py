import json
import os
import random
import requests
from datetime import datetime, timedelta
from flask import Flask, render_template, jsonify, request
from apscheduler.schedulers.background import BackgroundScheduler

caminho = os.path.dirname(os.path.abspath(__file__))

with open(os.path.join(caminho, 'config.json'), 'r', encoding='utf-8') as f:
    config = json.load(f)

app = Flask(__name__, template_folder='templates', static_folder='templates')

cache_clima = {"dados": {}, "ts": None}

def buscar_clima_accuweather():
    agora = datetime.now()
    if cache_clima["ts"] and agora - cache_clima["ts"] < timedelta(minutes=config['cache_minutos']):
        return cache_clima["dados"]
    try:
        chave     = config["accuweather"]["chave"]
        id_cidade = config["accuweather"]["id_cidade"]
        url = (f"http://dataservice.accuweather.com/currentconditions/v1/"
               f"{id_cidade}?apikey={chave}&language=pt-br&details=true")
        dados = requests.get(url, timeout=5).json()[0]
        cache_clima["dados"] = {
            "temperatura": dados["Temperature"]["Metric"]["Value"],
            "umidade":     dados["RelativeHumidity"]
        }
        cache_clima["ts"] = agora
    except Exception:
        if not cache_clima["dados"]:
            cache_clima["dados"] = {"temperatura": 25.0, "umidade": 60}
    return cache_clima["dados"]

def carregar_dados():
    caminho_json = os.path.join(caminho, 'sensores.json')
    if not os.path.exists(caminho_json):
        dados_iniciais = {"contador_sensores": 1, "historico_irrigacao": [], "sensores": []}
        salvar_dados(dados_iniciais)
        return dados_iniciais
    with open(caminho_json, 'r', encoding='utf-8') as f:
        return json.load(f)

def salvar_dados(data):
    caminho_json = os.path.join(caminho, 'sensores.json')
    with open(caminho_json, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def aplicar_falha(valor, falha, min_val, max_val, criado_em):
    faixa = max_val - min_val
    horas_vida = max((datetime.now() - datetime.fromisoformat(criado_em)).total_seconds() / 3600, 0)

    # Corrosão gradual afeta TODOS os sensores — quase imperceptível no início
    corrosao = horas_vida * 0.002 * random.uniform(0.8, 1.2)

    if falha == "variacao":
        # Pode estar dentro da faixa mas vai piorando com o tempo
        desvio = faixa * 0.15 + (horas_vida * 0.01)
        return round(valor + random.uniform(-desvio, desvio) + corrosao, 1)

    elif falha == "erro_deteccao":
        # Pode começar dentro da faixa mas rapidamente sai
        if horas_vida < 0.5:
            # No início pode ainda estar dentro da faixa
            return round(valor + random.uniform(-faixa * 0.1, faixa * 0.1), 1)
        return round(random.choice([
            min_val - random.uniform(5, 20) - corrosao * 5,
            max_val + random.uniform(5, 20) + corrosao * 5
        ]), 1)

    elif falha == "sem_resposta":
        # Quanto mais velho, mais chance de não responder
        chance_resposta = max(0, 1 - (horas_vida * 0.05))
        if random.random() > chance_resposta:
            return None
        return round(valor + corrosao * 3, 1)

    # Sem falha — corrosão quase imperceptível
    return round(valor + corrosao, 1)

def atualizar_sensor(sensor, valor_base, origem="auto"):
    agora = datetime.now().isoformat()
    valor = aplicar_falha(
        valor_base,
        sensor.get("falha"),
        sensor["min_val"],
        sensor["max_val"],
        sensor["criado_em"]
    )

    if valor is None:
        novo_status = "erro"
    elif valor < sensor["min_val"] or valor > sensor["max_val"]:
        novo_status = "erro" if abs(valor - sensor["min_val"]) > (sensor["max_val"] - sensor["min_val"]) * 0.3 else "alerta"
    else:
        novo_status = "ok"

    status_anterior = sensor.get("status_atual", "ok")

    sensor.setdefault("historico", []).append({
        "ts": agora, "valor": valor, "status": novo_status, "origem": origem
    })
    sensor["historico"] = sensor["historico"][-200:]

    if novo_status != status_anterior:
        sensor.setdefault("log", []).append({
            "ts": agora, "status": novo_status, "valor": valor, "origem": origem
        })

    sensor["ultimo_valor"]   = valor
    sensor["ultima_leitura"] = agora
    sensor["status_atual"]   = novo_status
    return sensor

def job_leitura_automatica():
    try:
        clima = buscar_clima_accuweather()
        data  = carregar_dados()
        agora = datetime.now().isoformat()
        for s in data["sensores"]:
            if s["modo"] != "externo":
                continue
            valor_base = clima["temperatura"] if s["tipo"] == "temp" else clima["umidade"]
            atualizar_sensor(s, valor_base, origem="auto")
        data.setdefault("log_auto", []).append({"ts": agora, "clima": clima, "ok": True})
        data["log_auto"] = data["log_auto"][-48:]
        salvar_dados(data)
        print(f"[{agora}] Leitura automática: {clima}")
    except Exception as e:
        print(f"[ERRO job_leitura_automatica] {e}")

scheduler = BackgroundScheduler()
scheduler.add_job(job_leitura_automatica, 'interval', minutes=30, id='leitura_auto')
scheduler.start()

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/gerenciar")
def gerenciar():
    return render_template("gerenciar.html")

@app.route("/api/sensores", methods=["GET"])
def listar_sensores():
    sensores = carregar_dados()["sensores"]
    return jsonify(sorted(sensores, key=lambda s: s.get("criado_em", ""), reverse=True))

@app.route("/api/sensores", methods=["POST"])
def criar_sensor():
    data   = carregar_dados()
    body   = request.json
    id_fmt = f"S{data['contador_sensores']:04d}"
    data["contador_sensores"] += 1
    sensor = {
        "id":             id_fmt,
        "nome":           f"Sensor-{id_fmt}",
        "tipo":           body["tipo"],
        "modo":           body["modo"],
        "min_val":        float(body["min_val"]),
        "max_val":        float(body["max_val"]),
        "falha":          body.get("falha") or None,
        "criado_em":      datetime.now().isoformat(),
        "historico":      [],
        "log":            [],
        "status_atual":   "ok",
        "ultimo_valor":   None,
        "ultima_leitura": None
    }
    if sensor["modo"] == "externo":
        clima = buscar_clima_accuweather()
        valor_base = clima["temperatura"] if sensor["tipo"] == "temp" else clima["umidade"]
        atualizar_sensor(sensor, valor_base, origem="auto")
    elif sensor["modo"] == "estufa" and sensor["tipo"] == "umid":
        valor_base = random.uniform(sensor["min_val"], sensor["max_val"])
        atualizar_sensor(sensor, valor_base, origem="auto")
    data["sensores"].append(sensor)
    salvar_dados(data)
    return jsonify(sensor), 201

@app.route("/api/sensores/<path:id_sensor>", methods=["GET"])
def get_sensor(id_sensor):
    data   = carregar_dados()
    sensor = next((s for s in data["sensores"] if s["id"] == id_sensor), None)
    if not sensor:
        return jsonify({"erro": "não encontrado"}), 404
    return jsonify(sensor)

@app.route("/api/sensores/<path:id_sensor>", methods=["PUT"])
def editar_sensor(id_sensor):
    data   = carregar_dados()
    sensor = next((s for s in data["sensores"] if s["id"] == id_sensor), None)
    if not sensor:
        return jsonify({"erro": "não encontrado"}), 404
    body = request.json
    for campo in ["tipo", "modo", "falha", "min_val", "max_val"]:
        if campo in body:
            sensor[campo] = body[campo]
    salvar_dados(data)
    return jsonify(sensor)

@app.route("/api/sensores/<path:id_sensor>", methods=["DELETE"])
def deletar_sensor(id_sensor):
    data  = carregar_dados()
    antes = len(data["sensores"])
    data["sensores"] = [s for s in data["sensores"] if s["id"] != id_sensor]
    if len(data["sensores"]) == antes:
        return jsonify({"erro": "não encontrado"}), 404
    salvar_dados(data)
    return jsonify({"ok": True})

@app.route("/api/sensores/<path:id_sensor>/leitura", methods=["POST"])
def leitura_manual(id_sensor):
    data   = carregar_dados()
    sensor = next((s for s in data["sensores"] if s["id"] == id_sensor), None)
    if not sensor:
        return jsonify({"erro": "não encontrado"}), 404
    if sensor["modo"] == "estufa" and sensor["tipo"] == "temp":
        return jsonify({"erro": "temperatura da estufa é registrada manualmente"}), 400
    if sensor["modo"] == "externo":
        clima = buscar_clima_accuweather()
        valor_base = clima["temperatura"] if sensor["tipo"] == "temp" else clima["umidade"]
    else:
        valor_base = sensor.get("ultimo_valor") or random.uniform(sensor["min_val"], sensor["max_val"])
    atualizar_sensor(sensor, valor_base, origem="manual")
    salvar_dados(data)
    return jsonify({"valor": sensor["ultimo_valor"], "status": sensor["status_atual"]})

@app.route("/api/clima", methods=["GET"])
def get_clima():
    return jsonify(buscar_clima_accuweather())

@app.route("/api/irrigacao", methods=["GET"])
def get_irrigacao():
    return jsonify(carregar_dados()["historico_irrigacao"])

@app.route("/api/irrigacao", methods=["POST"])
def registrar_irrigacao():
    data = carregar_dados()
    body = request.json or {}
    alertas = []
    for s in data["sensores"]:
        if s["tipo"] == "umid" and s["modo"] == "estufa" and s["ultimo_valor"] is not None:
            if s["ultimo_valor"] < s["min_val"]:
                alertas.append({"sensor_id": s["id"], "sensor_nome": s["nome"], "valor": s["ultimo_valor"], "min_val": s["min_val"]})
    entrada = {"ts": datetime.now().isoformat(), "observacao": body.get("observacao", ""), "alertas_umidade": alertas}
    data["historico_irrigacao"].append(entrada)
    data["historico_irrigacao"] = data["historico_irrigacao"][-100:]
    salvar_dados(data)
    return jsonify(entrada), 201

@app.route("/api/estufa/temperatura", methods=["POST"])
def registrar_temp_estufa():
    data  = carregar_dados()
    body  = request.json or {}
    valor = body.get("valor")
    if valor is None:
        return jsonify({"erro": "campo 'valor' obrigatório"}), 400
    valor = float(valor)
    atualizados = []
    for s in data["sensores"]:
        if s["tipo"] == "temp" and s["modo"] == "estufa":
            atualizar_sensor(s, valor, origem="manual")
            atualizados.append({"id": s["id"], "nome": s["nome"], "status": s["status_atual"]})
    salvar_dados(data)
    return jsonify({"valor": valor, "ts": datetime.now().isoformat(), "atualizados": atualizados}), 200

@app.route("/api/scheduler/status", methods=["GET"])
def scheduler_status():
    data    = carregar_dados()
    log     = data.get("log_auto", [])
    proxima = scheduler.get_job('leitura_auto').next_run_time
    return jsonify({
        "proxima_leitura": proxima.isoformat() if proxima else None,
        "ultima_leitura":  log[-1] if log else None,
        "total_hoje":      sum(1 for l in log if l["ts"][:10] == datetime.now().strftime("%Y-%m-%d"))
    })

if __name__ == "__main__":
    app.run(debug=True)