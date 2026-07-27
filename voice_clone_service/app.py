import io
import os
import tempfile
import threading

import soundfile as sf
import torch
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import Response

app = FastAPI(title="Lightcurve Voice Clone Service")
_model = None
_model_lock = threading.Lock()


def _authorized(authorization: str | None):
    expected = os.getenv("VOICE_CLONE_SERVICE_TOKEN", "")
    return not expected or authorization == f"Bearer {expected}"


def _device():
    configured = os.getenv("VOICE_CLONE_DEVICE", "auto")
    if configured != "auto":
        return configured
    return "cuda" if torch.cuda.is_available() else "cpu"


def _load_model():
    global _model
    if _model is not None:
        return _model
    with _model_lock:
        if _model is None:
            from chatterbox.tts_turbo import ChatterboxTurboTTS

            _model = ChatterboxTurboTTS.from_pretrained(device=_device())
    return _model


@app.get("/health")
def health():
    return {
        "ok": True,
        "model": "chatterbox-turbo",
        "device": _device(),
        "loaded": _model is not None,
    }


@app.post("/synthesize")
async def synthesize(
    text: str = Form(...),
    consent: bool = Form(False),
    speed: float = Form(1.0),
    emotion: str = Form("neutral"),
    reference: UploadFile = File(...),
    authorization: str | None = Header(default=None),
):
    if not _authorized(authorization):
        raise HTTPException(status_code=401, detail="Unauthorized")
    if not consent:
        raise HTTPException(status_code=400, detail="Explicit voice-cloning consent is required")
    if not text.strip() or len(text) > 1000:
        raise HTTPException(status_code=400, detail="Text must contain 1 to 1000 characters")

    reference_bytes = await reference.read()
    if len(reference_bytes) < 512 or len(reference_bytes) > 25 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Reference audio size is invalid")

    suffix = os.path.splitext(reference.filename or "reference.wav")[1] or ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix) as prompt_file:
        prompt_file.write(reference_bytes)
        prompt_file.flush()
        model = _load_model()
        prompt = text.strip()
        if emotion in {"laugh", "chuckle", "cough"}:
            prompt = f"[{emotion}] {prompt}"
        wav = model.generate(prompt, audio_prompt_path=prompt_file.name)

    samples = wav.squeeze().detach().cpu().float().numpy()
    if speed < 0.99 or speed > 1.01:
        source_indexes = torch.linspace(0, len(samples) - 1, max(1, round(len(samples) / max(0.5, min(2.0, speed)))))
        samples = torch.from_numpy(samples).view(1, 1, -1)
        samples = torch.nn.functional.interpolate(samples, size=len(source_indexes), mode="linear", align_corners=False).view(-1).numpy()
    output = io.BytesIO()
    sf.write(output, samples, model.sr, format="WAV", subtype="PCM_16")
    return Response(
        output.getvalue(),
        media_type="audio/wav",
        headers={"X-Lightcurve-Voice-Model": "chatterbox-turbo"},
    )

