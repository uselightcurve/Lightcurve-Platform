import os

from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from signals import analyze_audio

app = FastAPI(title="Lightcurve Evaluate Voice Service")


def authorized(authorization: str | None):
    token = os.getenv("MODELORBIT_SERVICE_TOKEN", "")
    return not token or authorization == f"Bearer {token}"


@app.get("/health")
def health():
    return {"ok": True, "serviceVersion": "modelorbit-signals-v1"}


@app.post("/analyze")
async def analyze(
    human: UploadFile = File(...),
    agent: UploadFile = File(...),
    authorization: str | None = Header(default=None),
):
    if not authorized(authorization):
        raise HTTPException(status_code=401, detail="Unauthorized")
    try:
        human_bytes = await human.read()
        agent_bytes = await agent.read()
        if len(human_bytes) > 50 * 1024 * 1024 or len(agent_bytes) > 50 * 1024 * 1024:
            raise ValueError("Audio file is too large")
        return {
            "human": analyze_audio(human_bytes),
            "agent": analyze_audio(agent_bytes),
            "serviceVersion": "modelorbit-signals-v1",
        }
    except Exception as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
