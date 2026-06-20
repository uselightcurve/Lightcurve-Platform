from __future__ import annotations

import asyncio
import base64
import io
import json
import logging
import os
import platform
import socket
import threading
import time
import wave
from fractions import Fraction
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen


logger = logging.getLogger("lightcurve")


class RuntimeClient:
    def __init__(self) -> None:
        self.api_key = os.getenv("LIGHTCURVE_API_KEY", "").strip()
        self.base_url = os.getenv("LIGHTCURVE_BASE_URL", "https://app.uselightcurve.com").rstrip("/")
        self.name = os.getenv("LIGHTCURVE_AGENT_NAME", "Pipecat agent").strip() or "Pipecat agent"
        self.instance_key = os.getenv("LIGHTCURVE_INSTANCE_ID", f"{socket.gethostname()}-{os.getpid()}")
        self.runtime_id: str | None = None
        self.instance_id: str | None = None
        self.worker: Any = None
        self.worker_loop: asyncio.AbstractEventLoop | None = None
        self.loop: asyncio.AbstractEventLoop | None = None
        self.output_tracks: set[Any] = set()
        self.events: dict[str, list[dict[str, Any]]] = {}
        self.transcripts: dict[str, list[dict[str, Any]]] = {}
        self.capture_started: dict[str, float] = {}
        self.seen_frame_ids: dict[str, set[int]] = {}
        self.agent_audio: dict[str, bytearray] = {}
        self.agent_audio_format: dict[str, tuple[int, int]] = {}
        self.active_capture_id: str | None = None
        self.busy = False
        self.bot_stopped_events: dict[str, asyncio.Event] = {}
        self.sequence = 0

    def request(self, method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        body = json.dumps(payload).encode() if payload is not None else None
        request = Request(
            f"{self.base_url}{path}",
            data=body,
            method=method,
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}",
                "X-Lightcurve-SDK": "python/0.4.0",
            },
        )
        try:
            with urlopen(request, timeout=35) as response:
                raw = response.read().decode()
                return json.loads(raw) if raw else {}
        except HTTPError as error:
            detail = error.read().decode()
            raise RuntimeError(f"Lightcurve API returned {error.code}: {detail}") from error

    async def request_async(self, method: str, path: str, payload: dict[str, Any] | None = None):
        return await asyncio.to_thread(self.request, method, path, payload)

    async def run(self) -> None:
        if not self.api_key:
            logger.warning("LIGHTCURVE_API_KEY is missing; Lightcurve auto-instrumentation is inactive.")
            return
        self.loop = asyncio.get_running_loop()
        registered = await self.request_async("POST", "/api/sdk/runtime/register", {
            "name": self.name,
            "instanceKey": self.instance_key,
            "version": os.getenv("LIGHTCURVE_AGENT_VERSION"),
            "gitSha": os.getenv("GITHUB_SHA") or os.getenv("LIGHTCURVE_GIT_SHA"),
            "capacity": int(os.getenv("LIGHTCURVE_CAPACITY", "1")),
            "metadata": {"python": platform.python_version(), "platform": platform.platform()},
        })
        self.runtime_id = registered["runtime"]["id"]
        self.instance_id = registered["instance"]["id"]
        logger.info("Lightcurve enabled for %s", self.name)
        await asyncio.gather(self._heartbeat_loop(), self._poll_loop(), self._flush_loop())

    async def _heartbeat_loop(self) -> None:
        while True:
            await asyncio.sleep(15)
            try:
                await self.request_async("POST", "/api/sdk/runtime/heartbeat", {
                    "runtimeId": self.runtime_id,
                    "instanceId": self.instance_id,
                    "activeSessions": len(self.output_tracks),
                })
            except Exception as error:
                logger.warning("Lightcurve heartbeat failed: %s", error)

    async def _poll_loop(self) -> None:
        while True:
            try:
                result = await self.request_async("POST", "/api/sdk/runtime/poll", {
                    "runtimeId": self.runtime_id,
                    "instanceId": self.instance_id,
                    "busy": self.busy,
                })
                command = result.get("command")
                if command and not self.busy:
                    self.busy = True
                    if command.get("type") == "capture.start":
                        asyncio.create_task(self._start_capture_safely(command))
                    elif command.get("type") == "replay.start":
                        asyncio.create_task(self._run_replay(command))
                    else:
                        self.busy = False
            except Exception as error:
                logger.warning("Lightcurve command poll failed: %s", error)
            await asyncio.sleep(1)

    async def _start_capture_safely(self, command: dict[str, Any]) -> None:
        try:
            await self._start_capture(command)
        except Exception as error:
            logger.exception("Lightcurve Playground connection failed: %s", error)
            self.busy = False

    async def _flush_loop(self) -> None:
        while True:
            await asyncio.sleep(1)
            for capture_id in list(self.events):
                if capture_id.startswith("replay:"):
                    continue
                events = self.events.get(capture_id, [])
                if not events:
                    continue
                self.events[capture_id] = []
                try:
                    await self.request_async("POST", f"/api/sdk/captures/{capture_id}/events", {
                        "events": events,
                        "transcript": self._normalized_transcript(capture_id),
                    })
                except Exception as error:
                    self.events[capture_id] = events + self.events.get(capture_id, [])
                    logger.warning("Lightcurve event upload failed: %s", error)

    async def _start_capture(self, command: dict[str, Any]) -> None:
        if self.worker is None:
            logger.error("A Playground call arrived before a Pipecat PipelineWorker was created.")
            self.busy = False
            return
        from aiortc import RTCConfiguration, RTCIceServer, RTCPeerConnection, RTCSessionDescription

        capture_id = command["captureSessionId"]
        servers = [
            RTCIceServer(
                urls=item.get("urls"),
                username=item.get("username"),
                credential=item.get("credential"),
            )
            for item in command.get("iceServers", [])
        ]
        peer = RTCPeerConnection(configuration=RTCConfiguration(iceServers=servers))
        output = LightcurveAudioTrack()
        self.output_tracks.add(output)
        self.active_capture_id = capture_id
        self.capture_started[capture_id] = time.monotonic()
        self.events[capture_id] = []
        self.transcripts[capture_id] = []
        self.seen_frame_ids[capture_id] = set()
        self.agent_audio[capture_id] = bytearray()
        peer.addTrack(output)

        @peer.on("track")
        async def on_track(track):
            if track.kind == "audio":
                asyncio.create_task(self._consume_human_audio(track, capture_id))

        @peer.on("connectionstatechange")
        async def on_connectionstatechange():
            if peer.connectionState in {"failed", "closed", "disconnected"}:
                self.output_tracks.discard(output)
                if self.active_capture_id == capture_id:
                    self.active_capture_id = None
                self.busy = False
                asyncio.create_task(self._upload_agent_audio(capture_id))

        offer = command["offer"]
        await peer.setRemoteDescription(RTCSessionDescription(sdp=offer["sdp"], type=offer["type"]))
        answer = await peer.createAnswer()
        await peer.setLocalDescription(answer)
        await self.request_async("POST", f"/api/sdk/captures/{capture_id}/answer", {
            "answer": {"type": peer.localDescription.type, "sdp": peer.localDescription.sdp},
        })

    async def _run_replay(self, command: dict[str, Any]) -> None:
        if self.worker is None:
            logger.error("A dataset replay arrived before a Pipecat PipelineWorker was created.")
            self.busy = False
            return
        job_id = command["jobId"]
        session_id = f"replay:{job_id}"
        graph = command.get("case", {}).get("behaviorGraph") or {}
        path = graph.get("observedPath") if isinstance(graph, dict) else None
        if not isinstance(path, list):
            path = graph.get("nodes", []) if isinstance(graph, dict) else []
        human_nodes = [node for node in path if isinstance(node, dict) and node.get("speaker") == "human"]
        self.active_capture_id = session_id
        self.capture_started[session_id] = time.monotonic()
        self.events[session_id] = []
        self.transcripts[session_id] = []
        self.seen_frame_ids[session_id] = set()
        self.bot_stopped_events[session_id] = asyncio.Event()
        graph_path: list[str] = []
        try:
            for node in human_nodes:
                node_id = str(node.get("id", ""))
                if not node_id:
                    continue
                agent_text = " ".join(
                    item["text"] for item in self._normalized_transcript(session_id)
                    if item.get("speaker") == "agent"
                )[-1500:]
                turn = await self.request_async("POST", f"/api/sdk/replays/{job_id}/turn", {
                    "nodeId": node_id,
                    "previousAgentText": agent_text,
                })
                audio = base64.b64decode(turn["audioBase64"])
                sample_rate = int(turn.get("sampleRate", 16000))
                channels = int(turn.get("channels", 1))
                self.transcripts[session_id].append({"speaker": "human", "text": turn["text"]})
                stopped = self.bot_stopped_events[session_id]
                stopped.clear()
                await self._feed_pcm(audio, sample_rate, channels)
                await self._feed_pcm(bytes(int(sample_rate * channels * 2 * 0.5)), sample_rate, channels)
                try:
                    await asyncio.wait_for(stopped.wait(), timeout=45)
                except asyncio.TimeoutError:
                    logger.warning("Agent did not finish a turn before the replay timeout.")
                graph_path.append(node_id)

            await self.request_async("POST", f"/api/sdk/replays/{job_id}/complete", {
                "transcript": self._normalized_transcript(session_id),
                "graphPath": graph_path,
            })
        except Exception as error:
            logger.exception("Lightcurve replay failed: %s", error)
        finally:
            if self.active_capture_id == session_id:
                self.active_capture_id = None
            self.bot_stopped_events.pop(session_id, None)
            self.busy = False

    async def _feed_pcm(self, audio: bytes, sample_rate: int, channels: int) -> None:
        from pipecat.frames.frames import InputAudioRawFrame

        worker_loop = self.worker_loop
        if worker_loop is None:
            raise RuntimeError("Pipecat pipeline has not started.")
        chunk_size = max(2, int(sample_rate * channels * 2 * 0.02))
        for offset in range(0, len(audio), chunk_size):
            chunk = audio[offset:offset + chunk_size]
            future = asyncio.run_coroutine_threadsafe(
                self.worker.queue_frame(InputAudioRawFrame(audio=chunk, sample_rate=sample_rate, num_channels=channels)),
                worker_loop,
            )
            await asyncio.wrap_future(future)
            await asyncio.sleep(0.02)

    def _normalized_transcript(self, session_id: str) -> list[dict[str, Any]]:
        normalized: list[dict[str, Any]] = []
        for item in self.transcripts.get(session_id, []):
            speaker = item.get("speaker")
            text = str(item.get("text", "")).strip()
            if speaker not in {"human", "agent"} or not text:
                continue
            if normalized and normalized[-1]["speaker"] == speaker:
                separator = "" if speaker == "agent" else " "
                normalized[-1]["text"] = f"{normalized[-1]['text']}{separator}{text}".strip()
            else:
                normalized.append({"speaker": speaker, "text": text})
        return normalized

    async def _upload_agent_audio(self, capture_id: str) -> None:
        audio = bytes(self.agent_audio.pop(capture_id, b""))
        audio_format = self.agent_audio_format.pop(capture_id, None)
        if not audio or not audio_format:
            return
        sample_rate, channels = audio_format
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as wav:
            wav.setnchannels(channels)
            wav.setsampwidth(2)
            wav.setframerate(sample_rate)
            wav.writeframes(audio)
        try:
            await self.request_async("POST", f"/api/sdk/captures/{capture_id}/audio", {
                "audioBase64": base64.b64encode(buffer.getvalue()).decode("ascii"),
            })
        except Exception as error:
            logger.warning("Lightcurve agent audio upload failed: %s", error)

    async def _consume_human_audio(self, track: Any, capture_id: str) -> None:
        from av import AudioResampler
        from pipecat.frames.frames import InputAudioRawFrame

        resampler = AudioResampler(format="s16", layout="mono", rate=16000)
        while True:
            try:
                frame = await track.recv()
            except Exception:
                return
            for converted in resampler.resample(frame):
                audio = bytes(converted.planes[0])
                worker_loop = self.worker_loop
                if worker_loop is None:
                    continue
                future = asyncio.run_coroutine_threadsafe(
                    self.worker.queue_frame(InputAudioRawFrame(audio=audio, sample_rate=16000, num_channels=1)),
                    worker_loop,
                )
                await asyncio.wrap_future(future)

    def observe_frame(self, frame: Any) -> None:
        capture_id = self.active_capture_id
        if not capture_id:
            return
        frame_id = id(frame)
        seen = self.seen_frame_ids.setdefault(capture_id, set())
        if frame_id in seen:
            return
        seen.add(frame_id)
        if len(seen) > 20_000:
            seen.clear()
            seen.add(frame_id)
        name = frame.__class__.__name__
        at_ms = int((time.monotonic() - self.capture_started.get(capture_id, time.monotonic())) * 1000)
        speaker = "human" if name.startswith("User") or name == "TranscriptionFrame" else "agent"
        event_type = {
            "UserStartedSpeakingFrame": "speech_started",
            "UserStoppedSpeakingFrame": "speech_stopped",
            "BotStartedSpeakingFrame": "speech_started",
            "BotStoppedSpeakingFrame": "speech_stopped",
            "FunctionCallsStartedFrame": "tool_started",
            "FunctionCallResultFrame": "tool_completed",
            "InterruptionFrame": "interruption",
        }.get(name)
        text = getattr(frame, "text", None)
        if name == "TranscriptionFrame" and getattr(frame, "finalized", True) is not False and isinstance(text, str) and text.strip():
            self.transcripts.setdefault(capture_id, []).append({"speaker": "human", "text": text.strip(), "startedAtMs": at_ms})
            event_type = "transcript"
        elif name in {"TTSTextFrame", "LLMTextFrame"} and isinstance(text, str) and text.strip():
            self.transcripts.setdefault(capture_id, []).append({"speaker": "agent", "text": text.strip(), "startedAtMs": at_ms})
            event_type = "transcript"
        if event_type:
            self.sequence += 1
            payload: dict[str, Any] = {}
            if text:
                payload["text"] = text
            if hasattr(frame, "function_name"):
                payload["functionName"] = frame.function_name
            self.events.setdefault(capture_id, []).append({
                "sequence": self.sequence,
                "eventType": event_type,
                "speaker": speaker,
                "timestampMs": at_ms,
                "payload": payload,
            })

        if name == "BotStoppedSpeakingFrame" and capture_id in self.bot_stopped_events and self.loop:
            self.loop.call_soon_threadsafe(self.bot_stopped_events[capture_id].set)

        if name == "OutputAudioRawFrame":
            if capture_id.startswith("replay:"):
                return
            audio_format = (frame.sample_rate, frame.num_channels)
            if capture_id not in self.agent_audio_format:
                self.agent_audio_format[capture_id] = audio_format
            if self.agent_audio_format[capture_id] == audio_format and len(self.agent_audio[capture_id]) < 50 * 1024 * 1024:
                self.agent_audio[capture_id].extend(frame.audio)
            for track in list(self.output_tracks):
                track.put_audio(frame.audio, frame.sample_rate, frame.num_channels)


class LightcurveAudioTrack:
    kind = "audio"

    def __new__(cls):
        from aiortc import MediaStreamTrack

        class Track(MediaStreamTrack):
            kind = "audio"

            def __init__(self):
                super().__init__()
                self.queue: asyncio.Queue[tuple[bytes, int, int]] = asyncio.Queue()
                self.loop = asyncio.get_running_loop()
                self.pts = 0

            def put_audio(self, audio: bytes, sample_rate: int, channels: int):
                self.loop.call_soon_threadsafe(self.queue.put_nowait, (audio, sample_rate, channels))

            async def recv(self):
                from av import AudioFrame

                audio, sample_rate, channels = await self.queue.get()
                layout = "mono" if channels == 1 else "stereo"
                samples = len(audio) // (2 * channels)
                frame = AudioFrame(format="s16", layout=layout, samples=samples)
                frame.planes[0].update(audio)
                frame.sample_rate = sample_rate
                frame.pts = self.pts
                frame.time_base = Fraction(1, sample_rate)
                self.pts += samples
                return frame

        return Track()


runtime = RuntimeClient()


def install_pipecat_instrumentation() -> None:
    try:
        from pipecat.observers.base_observer import BaseObserver
        from pipecat.pipeline.worker import PipelineWorker
    except ImportError:
        logger.warning("Pipecat is not installed; Lightcurve cannot instrument this process.")
        return

    class LightcurveObserver(BaseObserver):
        async def on_pipeline_started(self):
            runtime.worker_loop = asyncio.get_running_loop()

        async def on_push_frame(self, data):
            runtime.observe_frame(data.frame)

    original_init = PipelineWorker.__init__
    if getattr(original_init, "__lightcurve_instrumented__", False):
        return

    def instrumented_init(worker, pipeline, *args, **kwargs):
        observers = list(kwargs.get("observers") or [])
        observers.append(LightcurveObserver())
        kwargs["observers"] = observers
        original_init(worker, pipeline, *args, **kwargs)
        runtime.worker = worker

    instrumented_init.__lightcurve_instrumented__ = True
    PipelineWorker.__init__ = instrumented_init


def start() -> None:
    install_pipecat_instrumentation()
    if not runtime.api_key:
        logger.warning("Set LIGHTCURVE_API_KEY to enable Lightcurve.")
        return

    def run_background():
        asyncio.run(runtime.run())

    thread = threading.Thread(target=run_background, name="lightcurve-runtime", daemon=True)
    thread.start()
