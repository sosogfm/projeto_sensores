import json
import os
import requests
from datetime import datetime, timedelta    

from flask import Flask 
app = Flask(__name__)

if __name__ == "__main__":
    app.run(debug=True)

    caminho = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(caminho, 'config.json'), 'r', encoding='utf-8') as f:
        config = json.load(f)

cache_tempo = None
cache_dados = {}

def buscar_dados_accuweather(id_cidade):
    global cache_tempo, cache_dados

    agora = datetime.now()