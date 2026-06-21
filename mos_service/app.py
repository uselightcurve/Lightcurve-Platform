import json
import os
import re
import subprocess
import tempfile
from pathlib import Path

import librosa
import numpy as np
import onnxruntime as ort
import soundfile as sf
from flask import Flask, jsonify, request
from google.cloud import storage

app = Flask(__name__)
gcs = storage.Client()
VISQOL_BIN = os.getenv("VISQOL_BIN", "/opt/visqol/visqol")
VISQOL_MODEL = os.getenv("VISQOL_MODEL", "/opt/visqol/lattice_tcditugenmeetpackhref_ls2_nl60_lr12_bs2048_learn.005_ep2400_train1_7_raw.tflite")
DNSMOS_MODEL = os.getenv("DNSMOS_MODEL", "/opt/dnsmos/sig_bak_ovr.onnx")
SERVICE_TOKEN = os.getenv("MOS_SERVICE_TOKEN")


def require_token():
    if SERVICE_TOKEN and request.headers.get("Authorization") != f"Bearer {SERVICE_TOKEN}":
        return jsonify({"error": "Unauthorized."}), 401
    return None


def localize(uri: str, directory: str, name: str) -> str:
    if not isinstance(uri, str) or not uri.startswith("gs://"):
        raise ValueError("Audio artifacts must use private gs:// URIs.")
    bucket_name, object_name = uri[5:].split("/", 1)
    output = str(Path(directory) / name)
    gcs.bucket(bucket_name).blob(object_name).download_to_filename(output)
    return output


def mono_16k(path: str) -> tuple[np.ndarray, int]:
    audio, sample_rate = sf.read(path, dtype="float32", always_2d=False)
    if audio.ndim > 1:
        audio = np.mean(audio, axis=1)
    if sample_rate != 16000:
        audio = librosa.resample(audio, orig_sr=sample_rate, target_sr=16000)
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if peak > 1.0:
        audio = audio / peak
    return audio.astype(np.float32), 16000


def write_aligned_wavs(reference_path: str, degraded_path: str, directory: str) -> tuple[str, str]:
    reference, sample_rate = mono_16k(reference_path)
    degraded, _ = mono_16k(degraded_path)
    size = min(reference.size, degraded.size)
    if size < sample_rate // 2:
        raise ValueError("Caller audio is too short for reference-based scoring.")
    reference_out = str(Path(directory) / "reference-16k.wav")
    degraded_out = str(Path(directory) / "degraded-16k.wav")
    sf.write(reference_out, reference[:size], sample_rate, subtype="PCM_16")
    sf.write(degraded_out, degraded[:size], sample_rate, subtype="PCM_16")
    return reference_out, degraded_out


def visqol_score(reference_path: str, degraded_path: str, directory: str) -> float:
    if not Path(VISQOL_BIN).exists() or not Path(VISQOL_MODEL).exists():
        raise RuntimeError("ViSQOL runtime assets are unavailable.")
    reference, degraded = write_aligned_wavs(reference_path, degraded_path, directory)
    process = subprocess.run([
        VISQOL_BIN,
        "--reference_file", reference,
        "--degraded_file", degraded,
        "--similarity_to_quality_model", VISQOL_MODEL,
        "--use_speech_mode=true",
        "--verbose",
    ], check=True, capture_output=True, text=True, timeout=90)
    output = f"{process.stdout}\n{process.stderr}"
    match = re.search(r"MOS-LQO\s*[:=]\s*([0-9.]+)", output, re.IGNORECASE)
    if not match:
        match = re.search(r"moslqo[^0-9]*([0-9.]+)", output, re.IGNORECASE)
    if not match:
        raise RuntimeError("ViSQOL returned no MOS-LQO value.")
    return round(float(match.group(1)), 4)


def calibrate_dns(raw: np.ndarray) -> tuple[float, float, float]:
    signal, background, overall = [float(value) for value in raw[:3]]
    signal = -0.08397278 * signal ** 3 + 1.22083953 * signal ** 2 + 0.0052439 * signal + 0.11493445
    background = -0.13166888 * background ** 3 + 1.60915514 * background ** 2 - 0.39604546 * background + 0.3210673
    overall = -0.06766283 * overall ** 3 + 1.11546468 * overall ** 2 + 0.04602535 * overall - 0.01179153
    return tuple(float(np.clip(value, 1.0, 5.0)) for value in (signal, background, overall))


def dnsmos_score(agent_path: str) -> dict[str, float]:
    if not Path(DNSMOS_MODEL).exists():
        raise RuntimeError("DNSMOS P.835 model is unavailable.")
    audio, sample_rate = mono_16k(agent_path)
    segment_samples = int(9.01 * sample_rate)
    if audio.size < sample_rate:
        raise ValueError("Agent audio is too short for DNSMOS scoring.")
    while audio.size < segment_samples:
        audio = np.concatenate((audio, audio))
    session = ort.InferenceSession(DNSMOS_MODEL, providers=["CPUExecutionProvider"])
    input_name = session.get_inputs()[0].name
    scores = []
    hop = sample_rate
    for start in range(0, max(1, audio.size - segment_samples + 1), hop):
        segment = audio[start:start + segment_samples]
        if segment.size < segment_samples:
            break
        raw = np.asarray(session.run(None, {input_name: segment[np.newaxis, :].astype(np.float32)})[0]).reshape(-1)
        scores.append(calibrate_dns(raw))
    if not scores:
        raise RuntimeError("DNSMOS produced no valid audio windows.")
    signal, background, overall = np.mean(np.asarray(scores), axis=0)
    return {
        "overall": round(float(overall), 4),
        "signal": round(float(signal), 4),
        "background": round(float(background), 4),
    }


@app.get("/health")
def health():
    return jsonify({
        "ok": True,
        "serviceVersion": "2.0.0",
        "visqolReady": Path(VISQOL_BIN).exists() and Path(VISQOL_MODEL).exists(),
        "dnsmosReady": Path(DNSMOS_MODEL).exists(),
    })


@app.post("/score")
def score():
    unauthorized = require_token()
    if unauthorized:
        return unauthorized
    payload = request.get_json(silent=True) or {}
    try:
        with tempfile.TemporaryDirectory() as directory:
            pairs = payload.get("callerPairs") or [{
                "cleanCallerUri": payload.get("cleanCallerUri"),
                "impairedCallerUri": payload.get("impairedCallerUri"),
            }]
            if not isinstance(pairs, list) or not pairs:
                raise ValueError("At least one clean/impaired caller pair is required.")
            visqol_scores = []
            for index, pair in enumerate(pairs[:50]):
                clean = localize(pair.get("cleanCallerUri"), directory, f"clean-{index}.wav")
                impaired = localize(pair.get("impairedCallerUri"), directory, f"impaired-{index}.wav")
                pair_directory = str(Path(directory) / f"pair-{index}")
                Path(pair_directory).mkdir()
                visqol_scores.append(visqol_score(clean, impaired, pair_directory))
            agent = localize(payload.get("agentUri"), directory, "agent.wav")
            return jsonify({
                "serviceVersion": "2.0.0",
                "visqol": {"mosLqo": round(float(np.mean(visqol_scores)), 4), "pairCount": len(visqol_scores)},
                "dnsmos": dnsmos_score(agent),
            })
    except (ValueError, RuntimeError, subprocess.SubprocessError, json.JSONDecodeError) as error:
        app.logger.warning("MOS scoring unavailable: %s", error)
        return jsonify({"error": str(error), "retryable": True}), 503
    except Exception as error:
        app.logger.exception("MOS scoring failed")
        return jsonify({"error": str(error), "retryable": True}), 503


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "8080")))
