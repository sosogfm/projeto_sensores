import json
import os
import random
import requests
from datetime import datetime, timedelta
from flask import Flask, render_template, jsonify, request

caminho = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(caminho, 'config.json'), 'r', encoding='utf-8') as f:
    config = json.load(f)

app = Flask(__name__, template_folder='templates', static_folder='templates')

cache_tempo = None
cache_dados = {}

def buscar_dados_accuweather():
    global cache_tempo, cache_dados
    agora = datetime.now()
    if cache_tempo and agora - cache_tempo < timedelta(minutes=config['cache_minutos']):
        return cache_dados
    try:
        chave = config["accuweather"]["chave"]
        id_cidade = config["accuweather"]["id_cidade"]
        url = f"http://dataservice.accuweather.com/currentconditions/v1/{id_cidade}?apikey={chave}&language=pt-br&details=true"
        resposta = requests.get(url, timeout=5)
        dados = resposta.json()[0]
        cache_dados = {
            "temperatura": dados["Temperature"]["Metric"]["Value"],
            "umidade": dados["RelativeHumidity"]
        }
        cache_tempo = agora
    except Exception:
        if not cache_dados:
            cache_dados = {"temperatura": 25.0, "umidade": 60}
    return cache_dados

def carregar_dados():
    caminho_json = os.path.join(caminho, 'sensores.json')
    if not os.path.exists(caminho_json):
        return {
            "contador_sensores": 1,
            "historico_irrigacao": [],
            "sensores": []
        }
    with open(caminho_json, 'r', encoding='utf-8') as f:
        return json.load(f)

def salvar_dados(data):
    caminho_json = os.path.join(caminho, 'sensores.json')
    with open(caminho_json, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/gerenciar")
def gerenciar():
    return render_template("gerenciar.html")

@app.route("/api/sensores", methods=["GET"])
def listar_sensores():
    data = carregar_dados()
    return jsonify(data["sensores"])

@app.route("/api/sensores", methods=["POST"])
def criar_sensor():
    data = carregar_dados()
    body = request.json
    id_fmt = f"#{data['contador_sensores']:04d}"
    data["contador_sensores"] += 1
    sensor = {
        "id": id_fmt,
        "nome": f"Sensor{id_fmt}",
        "tipo": body["tipo"],
        "modo": body["modo"],
        "min_val": float(body["min_val"]),
        "max_val": float(body["max_val"]),
        "falha": body.get("falha"),
        "criado_em": datetime.now().isoformat(),
        "historico": [],
        "log": [],
        "status_atual": "ok",
        "ultimo_valor": None,
        "ultima_leitura": None
    }
    data["sensores"].append(sensor)
    salvar_dados(data)
    return jsonify(sensor), 201

@app.route("/api/sensores/<id_sensor>", methods=["GET"])
def get_sensor(id_sensor):
    data = carregar_dados()
    sensor = next((s for s in data["sensores"] if s["id"] == id_sensor), None)
    if not sensor:
        return jsonify({"erro": "não encontrado"}), 404
    return jsonify(sensor)

@app.route("/api/sensores/<id_sensor>", methods=["PUT"])
def editar_sensor(id_sensor):
    data = carregar_dados()
    sensor = next((s for s in data["sensores"] if s["id"] == id_sensor), None)
    if not sensor:
        return jsonify({"erro": "não encontrado"}), 404
    body = request.json
    for campo in ["tipo", "modo", "falha", "min_val", "max_val"]:
        if campo in body:
            sensor[campo] = body[campo]
    salvar_dados(data)
    return jsonify(sensor)

@app.route("/api/sensores/<id_sensor>", methods=["DELETE"])
def deletar_sensor(id_sensor):
    data = carregar_dados()
    antes = len(data["sensores"])
    data["sensores"] = [s for s in data["sensores"] if s["id"] != id_sensor]
    if len(data["sensores"]) == antes:
        return jsonify({"erro": "não encontrado"}), 404
    salvar_dados(data)
    return jsonify({"ok": True})

@app.route("/api/clima", methods=["GET"])
def get_clima():
    return jsonify(buscar_dados_accuweather())

@app.route("/api/irrigacao", methods=["POST"])
def registrar_irrigacao():
    data = carregar_dados()
    entrada = {"ts": datetime.now().isoformat()}
    data["historico_irrigacao"].append(entrada)
    data["historico_irrigacao"] = data["historico_irrigacao"][-50:]
    salvar_dados(data)
    return jsonify(entrada), 201

@app.route("/api/irrigacao", methods=["GET"])
def get_irrigacao():
    data = carregar_dados()
    return jsonify(data["historico_irrigacao"])

if __name__ == "__main__":
    app.run(debug=True)