from flask import Flask, request, jsonify
import requests, tempfile, subprocess
from pypesq import pesq
import soundfile as sf
import numpy as np

app = Flask(__name__)

@app.route('/mos', methods=['POST'])
def compute_mos():
    data = request.json
    ref_path = download(data['ref_url'])
    deg_path = download(data['deg_url'])
    ref_8k = resample(ref_path, 8000)
    deg_8k = resample(deg_path, 8000)
    ref, sr = sf.read(ref_8k)
    deg, _  = sf.read(deg_8k)
    min_len = min(len(ref), len(deg))
    score = pesq(sr, ref[:min_len], deg[:min_len], 'nb')
    return jsonify({'mos': round(float(score), 3), 'mode': 'nb'})

def download(url):
    tmp = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
    tmp.write(requests.get(url).content)
    return tmp.name

def resample(path, target_sr):
    out = path.replace('.wav', f'_{target_sr}.wav')
    subprocess.run(['ffmpeg','-i',path,'-ar',str(target_sr),'-ac','1',out,'-y'], capture_output=True)
    return out

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8080)
