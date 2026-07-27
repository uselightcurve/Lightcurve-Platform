import os

import numpy as np
from flask import Flask, jsonify, request
from sentence_transformers import SentenceTransformer

app = Flask(__name__)

MODEL_NAME = os.getenv("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
SERVICE_TOKEN = os.getenv("EMBEDDING_SERVICE_TOKEN", "")
_model = None


def model():
    global _model
    if _model is None:
        _model = SentenceTransformer(MODEL_NAME)
    return _model


def require_token():
    if SERVICE_TOKEN and request.headers.get("Authorization") != f"Bearer {SERVICE_TOKEN}":
        return jsonify({"error": "Unauthorized."}), 401
    return None


@app.get("/health")
def health():
    return jsonify({"ok": True, "model": MODEL_NAME})


@app.post("/embed")
def embed():
    unauthorized = require_token()
    if unauthorized:
        return unauthorized
    payload = request.get_json(silent=True) or {}
    text = payload.get("text")
    if not isinstance(text, str) or not text.strip():
        return jsonify({"error": "text is required."}), 400
    vector = model().encode(text, normalize_embeddings=True)
    return jsonify({
        "model": MODEL_NAME,
        "embedding": np.asarray(vector, dtype=float).tolist(),
    })


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "8080")))
