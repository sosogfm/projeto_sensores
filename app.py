import json
import os
import random
import requests
from datetime import datetime, timedelta
from flask import Flask

caminho = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(caminho, 'config.json'), 'r', encoding='utf-8') as f:
    config = json.load(f)

app = Flask(__name__)

cache_tempo = None
cache_dados = {}

def buscar_dados_accuweather():
    global cache_tempo, cache_dados

    agora = datetime.now()
    if cache_tempo and agora - cache_tempo < timedelta(minutes=config['cache_minutos']):
        return cache_dados

    chave = config["accuweather"]["chave"]
    id_cidade = config["accuweather"]["id_cidade"]
    url = f"http://dataservice.accuweather.com/currentconditions/v1/{id_cidade}?apikey={chave}&language=pt-br&details=true"
    resposta = requests.get(url)
    dados = resposta.json()[0]

    cache_dados = {
        "temperatura": dados["Temperature"]["Metric"]["Value"],
        "umidade": dados["RelativeHumidity"]
    }
    cache_tempo = agora
    return cache_dados

sensores = []
contador_id = 1

def gerar_id():
    global contador_id
    id_formatado = f"#{contador_id:04d}"
    contador_id += 1
    return id_formatado

if __name__ == "__main__":
    app.run(debug=True)