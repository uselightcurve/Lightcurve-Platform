import json
import os
import re
import subprocess
import tempfile
import base64
import email.utils
import hashlib
import hmac
import urllib.parse
import urllib.request
from pathlib import Path

import librosa
import numpy as np
import onnxruntime as ort
import soundfile as sf
from flask import Flask, jsonify, request

app = Flask(__name__)


VISQOL_BIN = os.getenv("VISQOL_BIN", "/opt/visqol/visqol")
VISQOL_MODEL = os.getenv("VISQOL_MODEL", "/opt/visqol/lattice_tcditugenmeetpackhref_ls2_nl60_lr12_bs2048_learn.005_ep2400_train1_7_raw.tflite")
DNSMOS_MODEL = os.getenv("DNSMOS_MODEL", "/opt/dnsmos/sig_bak_ovr.onnx")
SERVICE_TOKEN = os.getenv("MOS_SERVICE_TOKEN")


def local_storage_root() -> Path:
    return Path(os.getenv("LOCAL_STORAGE_DIR", "/data/lightcurve")).resolve()


def local_audio_path(object_name: str) -> Path:
    root = local_storage_root()
    target = (root / object_name).resolve()
    try:
        target.relative_to(root)
    except ValueError as error:
        raise ValueError("Invalid local audio object path.") from error
    if not target.exists():
        raise ValueError("Local audio object does not exist.")
    return target


def require_token():
    if SERVICE_TOKEN and request.headers.get("Authorization") != f"Bearer {SERVICE_TOKEN}":
        return jsonify({"error": "Unauthorized."}), 401
    return None


def azure_connection_parts() -> dict[str, str]:
    raw = os.getenv("AZURE_STORAGE_CONNECTION_STRING", "")
    parts = {}
    for item in raw.split(";"):
        if "=" in item:
            key, value = item.split("=", 1)
            parts[key] = value
    return parts


def azure_config() -> dict[str, str]:
    parts = azure_connection_parts()
    account = os.getenv("AZURE_STORAGE_ACCOUNT") or parts.get("AccountName")
    key = os.getenv("AZURE_STORAGE_ACCOUNT_KEY") or parts.get("AccountKey")
    protocol = parts.get("DefaultEndpointsProtocol", "https")
    endpoint = os.getenv("AZURE_STORAGE_BLOB_ENDPOINT") or parts.get("BlobEndpoint") or f"{protocol}://{account}.blob.core.windows.net"
    if not account or not key:
        raise ValueError("Azure Blob storage credentials are not configured.")
    return {"account": account, "key": key, "endpoint": endpoint.rstrip("/")}


def canonicalized_headers(headers: dict[str, str]) -> str:
    values = []
    for key, value in headers.items():
        lower = key.lower()
        if lower.startswith("x-ms-"):
            values.append((lower, " ".join(str(value).strip().split())))
    return "".join(f"{key}:{value}\n" for key, value in sorted(values))


def canonicalized_resource(account: str, parsed: urllib.parse.ParseResult) -> str:
    query = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
    canonical_query = "".join(f"\n{key.lower()}:{value}" for key, value in sorted(query))
    return f"/{account}{parsed.path}{canonical_query}"


def shared_key_authorization(method: str, url: str, headers: dict[str, str], account: str, key: str) -> str:
    lower_headers = {name.lower(): str(value) for name, value in headers.items()}

    def header(name: str) -> str:
        return lower_headers.get(name, "")

    content_length = "" if header("content-length") == "0" else header("content-length")
    standard = "\n".join([
        method.upper(),
        header("content-encoding"),
        header("content-language"),
        content_length,
        header("content-md5"),
        header("content-type"),
        "",
        header("if-modified-since"),
        header("if-match"),
        header("if-none-match"),
        header("if-unmodified-since"),
        header("range"),
    ])
    parsed = urllib.parse.urlparse(url)
    string_to_sign = f"{standard}\n{canonicalized_headers(headers)}{canonicalized_resource(account, parsed)}"
    signature = base64.b64encode(hmac.new(base64.b64decode(key), string_to_sign.encode("utf-8"), hashlib.sha256).digest()).decode("ascii")
    return f"SharedKey {account}:{signature}"


def azure_blob_url(endpoint: str, container: str, object_name: str) -> str:
    quoted = "/".join(urllib.parse.quote(part, safe="") for part in object_name.split("/"))
    return f"{endpoint}/{container}/{quoted}"


def download_azure_blob(uri: str, directory: str, name: str) -> str:
    container, object_name = uri[len("azblob://"):].split("/", 1)
    config = azure_config()
    url = azure_blob_url(config["endpoint"], container, object_name)
    headers = {
        "x-ms-date": email.utils.formatdate(usegmt=True),
        "x-ms-version": "2023-11-03",
    }
    headers["Authorization"] = shared_key_authorization("GET", url, headers, config["account"], config["key"])
    output = str(Path(directory) / name)
    req = urllib.request.Request(url, headers=headers, method="GET")
    with urllib.request.urlopen(req, timeout=90) as response, open(output, "wb") as handle:
        handle.write(response.read())
    return output


def localize(uri: str, directory: str, name: str) -> str:
    if not isinstance(uri, str):
        raise ValueError("Audio artifacts must use private azblob:// or local:// URIs.")
    if uri.startswith("local://"):
        return str(local_audio_path(uri[len("local://"):]))
    if uri.startswith("azblob://"):
        return download_azure_blob(uri, directory, name)
    raise ValueError("Audio artifacts must use private azblob:// or local:// URIs.")


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
