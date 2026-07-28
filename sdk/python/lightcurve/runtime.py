from __future__ import annotations

import asyncio
import base64
import io
import json
import logging
import os
import platform
import random
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
        self.framework = os.getenv("LIGHTCURVE_AGENT_FRAMEWORK", "pipecat").strip() or "pipecat"
        self.instance_key = os.getenv("LIGHTCURVE_INSTANCE_ID", f"{socket.gethostname()}-{os.getpid()}")
        self.runtime_id: str | None = None
        self.instance_id: str | None = None
        self.max_capacity = max(1, int(os.getenv("LIGHTCURVE_CAPACITY", "1")))
        self.workers: list[Any] = []
        self.worker_loops: dict[int, asyncio.AbstractEventLoop] = {}
        self.worker_sessions: dict[int, str] = {}
        self.loop: asyncio.AbstractEventLoop | None = None
        self.output_tracks: dict[str, set[Any]] = {}
        self.events: dict[str, list[dict[str, Any]]] = {}
        self.transcripts: dict[str, list[dict[str, Any]]] = {}
        self.capture_started: dict[str, float] = {}
        self.seen_frame_ids: dict[str, set[int]] = {}
        self.agent_audio: dict[str, bytearray] = {}
        self.agent_audio_format: dict[str, tuple[int, int]] = {}
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
                "X-Lightcurve-SDK": "python/0.5.1",
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
            "framework": self.framework,
            "instanceKey": self.instance_key,
            "version": os.getenv("LIGHTCURVE_AGENT_VERSION"),
            "gitSha": os.getenv("GITHUB_SHA") or os.getenv("LIGHTCURVE_GIT_SHA"),
            "capacity": self.max_capacity,
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
                    "activeSessions": len(self.worker_sessions),
                    "capacity": self.effective_capacity(),
                })
            except Exception as error:
                logger.warning("Lightcurve heartbeat failed: %s", error)

    async def _poll_loop(self) -> None:
        while True:
            try:
                available = self.available_workers()
                result = await self.request_async("POST", "/api/sdk/runtime/poll", {
                    "runtimeId": self.runtime_id,
                    "instanceId": self.instance_id,
                    "busy": not available,
                    "activeSessions": len(self.worker_sessions),
                    "capacity": self.effective_capacity(),
                    "availableCapacity": len(available),
                })
                commands = result.get("commands")
                if not isinstance(commands, list):
                    commands = [result.get("command")] if result.get("command") else []
                for command in commands:
                    if not isinstance(command, dict):
                        continue
                    session_id = command.get("captureSessionId") if command.get("type") == "capture.start" else f"replay:{command.get('jobId')}"
                    worker = self.claim_worker(str(session_id))
                    if worker is None:
                        break
                    if command.get("type") == "capture.start":
                        asyncio.create_task(self._start_capture_safely(command, worker))
                    elif command.get("type") == "replay.start":
                        asyncio.create_task(self._run_replay(command, worker))
                    else:
                        self.release_worker(worker)
            except Exception as error:
                logger.warning("Lightcurve command poll failed: %s", error)
            await asyncio.sleep(1)

    def effective_capacity(self) -> int:
        ready = sum(1 for worker in self.workers if id(worker) in self.worker_loops)
        return min(self.max_capacity, ready)

    def available_workers(self) -> list[Any]:
        return [
            worker for worker in self.workers
            if id(worker) in self.worker_loops and id(worker) not in self.worker_sessions
        ][:self.max_capacity]

    def claim_worker(self, session_id: str) -> Any | None:
        available = self.available_workers()
        if not available:
            return None
        worker = available[0]
        self.worker_sessions[id(worker)] = session_id
        return worker

    def release_worker(self, worker: Any) -> None:
        self.worker_sessions.pop(id(worker), None)

    async def _start_capture_safely(self, command: dict[str, Any], worker: Any) -> None:
        try:
            await self._start_capture(command, worker)
        except Exception as error:
            logger.exception("Lightcurve Playground connection failed: %s", error)
            self.release_worker(worker)

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

    async def _start_capture(self, command: dict[str, Any], worker: Any) -> None:
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
        self.output_tracks[capture_id] = {output}
        self.capture_started[capture_id] = time.monotonic()
        self.events[capture_id] = []
        self.transcripts[capture_id] = []
        self.seen_frame_ids[capture_id] = set()
        self.agent_audio[capture_id] = bytearray()
        peer.addTrack(output)

        @peer.on("track")
        async def on_track(track):
            if track.kind == "audio":
                asyncio.create_task(self._consume_human_audio(track, capture_id, worker))

        @peer.on("connectionstatechange")
        async def on_connectionstatechange():
            if peer.connectionState in {"failed", "closed", "disconnected"}:
                self.output_tracks.pop(capture_id, None)
                self.release_worker(worker)
                asyncio.create_task(self._upload_agent_audio(capture_id))

        offer = command["offer"]
        await peer.setRemoteDescription(RTCSessionDescription(sdp=offer["sdp"], type=offer["type"]))
        answer = await peer.createAnswer()
        await peer.setLocalDescription(answer)
        await self.request_async("POST", f"/api/sdk/captures/{capture_id}/answer", {
            "answer": {"type": peer.localDescription.type, "sdp": peer.localDescription.sdp},
        })

    async def _run_replay(self, command: dict[str, Any], worker: Any) -> None:
        job_id = command["jobId"]
        session_id = f"replay:{job_id}"
        graph = command.get("case", {}).get("behaviorGraph") or {}
        manifest = command.get("manifest") or {}
        path = graph.get("observedPath") if isinstance(graph, dict) else None
        if not isinstance(path, list):
            path = graph.get("nodes", []) if isinstance(graph, dict) else []
        nodes_by_id = {str(node.get("id")): node for node in path if isinstance(node, dict)}
        manifest_path = manifest.get("graphPath") if isinstance(manifest, dict) else None
        if isinstance(manifest_path, list) and manifest_path:
            human_nodes = [
                nodes_by_id[str(node_id)] for node_id in manifest_path
                if str(node_id) in nodes_by_id and nodes_by_id[str(node_id)].get("speaker") == "human"
            ]
        else:
            human_nodes = [node for node in path if isinstance(node, dict) and node.get("speaker") == "human"]
        self.capture_started[session_id] = time.monotonic()
        self.events[session_id] = []
        self.transcripts[session_id] = []
        self.seen_frame_ids[session_id] = set()
        self.agent_audio[session_id] = bytearray()
        self.bot_stopped_events[session_id] = asyncio.Event()
        graph_path: list[str] = []
        caller_artifacts: list[dict[str, Any]] = []
        caller_room = None
        caller_source = None
        try:
            livekit_caller = command.get("livekitCaller")
            if isinstance(livekit_caller, dict):
                from livekit import rtc
                caller_room = rtc.Room()
                await caller_room.connect(str(livekit_caller["url"]), str(livekit_caller["token"]))
                caller_source = rtc.AudioSource(16000, 1)
                caller_track = rtc.LocalAudioTrack.create_audio_track("lightcurve_caller", caller_source)
                await caller_room.local_participant.publish_track(
                    caller_track,
                    rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE),
                )
                await asyncio.sleep(1)
            for index, node in enumerate(human_nodes):
                agent_turns_before = sum(1 for item in self._normalized_transcript(session_id) if item.get("speaker") == "agent")
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
                self.transcripts[session_id].append({
                    "speaker": "human",
                    "text": turn["text"],
                    "startedAtMs": int((time.monotonic() - self.capture_started[session_id]) * 1000),
                })
                if isinstance(turn.get("artifacts"), dict):
                    caller_artifacts.append(turn["artifacts"])
                stopped = self.bot_stopped_events[session_id]
                stopped.clear()
                timing = turn.get("timing") if isinstance(turn.get("timing"), dict) else {}
                response_delay = max(0, min(5000, int(timing.get("responseDelayMs", 0))))
                if response_delay:
                    await asyncio.sleep(response_delay / 1000)
                await self._feed_pcm(worker, audio, sample_rate, channels, turn.get("transport") or {}, command.get("replaySeed", 42) + index, caller_source)
                await self._feed_pcm(worker, bytes(int(sample_rate * channels * 2 * 0.5)), sample_rate, channels, {}, command.get("replaySeed", 42) + index + 1, caller_source)
                interruption_offset = timing.get("interruptionOffsetMs") if index + 1 < len(human_nodes) else None
                if interruption_offset is not None:
                    await asyncio.sleep(max(0, min(5000, int(interruption_offset))) / 1000)
                else:
                    try:
                        await asyncio.wait_for(stopped.wait(), timeout=12)
                    except asyncio.TimeoutError:
                        logger.warning("Agent did not finish a turn before the replay timeout.")
                agent_turns_after = sum(1 for item in self._normalized_transcript(session_id) if item.get("speaker") == "agent")
                if agent_turns_after <= agent_turns_before:
                    raise RuntimeError("Agent did not produce a replay response. Check that the Lightcurve SDK is installed in the active LiveKit/Pipecat worker.")
                graph_path.append(node_id)

            agent_audio_url = await self._upload_replay_agent_audio(job_id, session_id)
            await self.request_async("POST", f"/api/sdk/replays/{job_id}/complete", {
                "transcript": self._normalized_transcript(session_id),
                "graphPath": graph_path,
                "artifacts": {"callerTurns": caller_artifacts, "agentAudioUrl": agent_audio_url},
                "events": self.events.get(session_id, []),
                "durationMs": int((time.monotonic() - self.capture_started[session_id]) * 1000),
            })
        except Exception as error:
            logger.exception("Lightcurve replay failed: %s", error)
            try:
                await self.request_async("POST", f"/api/sdk/replays/{job_id}/failed", {"error": str(error)})
            except Exception as report_error:
                logger.warning("Lightcurve could not report replay failure: %s", report_error)
        finally:
            if caller_room is not None:
                await caller_room.disconnect()
            self.bot_stopped_events.pop(session_id, None)
            self.release_worker(worker)

    async def _feed_pcm(self, worker: Any, audio: bytes, sample_rate: int, channels: int, transport: dict[str, Any], seed: int, replay_source: Any = None) -> None:
        worker_loop = self.worker_loops.get(id(worker))
        if worker_loop is None:
            raise RuntimeError("Agent pipeline has not started.")

        is_pipecat = hasattr(worker, "queue_frame")
        livekit_source = replay_source

        if not is_pipecat and livekit_source is None:
            room = getattr(worker, "room", None)
            if not room:
                raise RuntimeError("LiveKit JobContext has no active room for replay audio.")
            if not hasattr(worker, "_lightcurve_replay_source"):
                from livekit import rtc
                livekit_source = rtc.AudioSource(sample_rate, channels)
                livekit_source._is_lightcurve_replay_source = True
                track = rtc.LocalAudioTrack.create_audio_track("lightcurve_replay", livekit_source)
                options = rtc.TrackPublishOptions()
                options.source = rtc.TrackSource.SOURCE_MICROPHONE
                future = asyncio.run_coroutine_threadsafe(
                    room.local_participant.publish_track(track, options),
                    worker_loop
                )
                await asyncio.wrap_future(future)
                worker._lightcurve_replay_source = livekit_source
            else:
                livekit_source = worker._lightcurve_replay_source

        chunk_size = max(2, int(sample_rate * channels * 2 * 0.02))
        chunks = [audio[offset:offset + chunk_size] for offset in range(0, len(audio), chunk_size)]
        rng = random.Random(seed)
        base_latency = max(0, min(5000, int(transport.get("baseLatencyMs", 0))))
        jitter_ms = max(0, min(1000, int(transport.get("jitterMs", 0))))
        packet_loss = max(0.0, min(0.5, float(transport.get("packetLoss", 0))))
        burst_loss = max(0.0, min(0.8, float(transport.get("burstLoss", 0))))
        reorder = max(0.0, min(0.25, float(transport.get("reorderProbability", 0))))
        if base_latency:
            await asyncio.sleep(base_latency / 1000)
        burst = False
        for index, chunk in enumerate(chunks):
            loss_probability = burst_loss if burst else packet_loss
            if rng.random() < loss_probability:
                burst = True
                continue
            burst = False
            if index + 1 < len(chunks) and rng.random() < reorder:
                chunk, chunks[index + 1] = chunks[index + 1], chunk
                
            if is_pipecat:
                from pipecat.frames.frames import InputAudioRawFrame
                future = asyncio.run_coroutine_threadsafe(
                    worker.queue_frame(InputAudioRawFrame(audio=chunk, sample_rate=sample_rate, num_channels=channels)),
                    worker_loop,
                )
                await asyncio.wrap_future(future)
            else:
                from livekit import rtc
                frame = rtc.AudioFrame(chunk, sample_rate, channels, len(chunk) // (2 * channels))
                future = asyncio.run_coroutine_threadsafe(
                    asyncio.to_thread(livekit_source.capture_frame, frame),
                    worker_loop,
                )
                await asyncio.wrap_future(future)
                
            jitter = rng.uniform(-jitter_ms, jitter_ms) / 1000 if jitter_ms else 0
            await asyncio.sleep(max(0, 0.02 + jitter))

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

    async def _upload_replay_agent_audio(self, job_id: str, session_id: str) -> str | None:
        audio = bytes(self.agent_audio.pop(session_id, b""))
        audio_format = self.agent_audio_format.pop(session_id, None)
        if not audio or not audio_format:
            return None
        sample_rate, channels = audio_format
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as wav:
            wav.setnchannels(channels)
            wav.setsampwidth(2)
            wav.setframerate(sample_rate)
            wav.writeframes(audio)
        result = await self.request_async("POST", f"/api/sdk/replays/{job_id}/audio", {
            "audioBase64": base64.b64encode(buffer.getvalue()).decode("ascii"),
        })
        return result.get("audioUrl")

    async def _consume_human_audio(self, track: Any, capture_id: str, worker: Any) -> None:
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
                worker_loop = self.worker_loops.get(id(worker))
                if worker_loop is None:
                    continue
                future = asyncio.run_coroutine_threadsafe(
                    worker.queue_frame(InputAudioRawFrame(audio=audio, sample_rate=16000, num_channels=1)),
                    worker_loop,
                )
                await asyncio.wrap_future(future)

    def observe_frame(self, worker: Any, frame: Any) -> None:
        capture_id = self.worker_sessions.get(id(worker))
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
            audio_format = (frame.sample_rate, frame.num_channels)
            if capture_id not in self.agent_audio_format:
                self.agent_audio_format[capture_id] = audio_format
            if self.agent_audio_format[capture_id] == audio_format and len(self.agent_audio[capture_id]) < 50 * 1024 * 1024:
                self.agent_audio[capture_id].extend(frame.audio)
            for track in list(self.output_tracks.get(capture_id, set())):
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
        def __init__(self, worker):
            super().__init__()
            self.worker = worker

        async def on_pipeline_started(self):
            runtime.worker_loops[id(self.worker)] = asyncio.get_running_loop()

        async def on_push_frame(self, data):
            runtime.observe_frame(self.worker, data.frame)

    original_init = PipelineWorker.__init__
    if getattr(original_init, "__lightcurve_instrumented__", False):
        return

    def instrumented_init(worker, pipeline, *args, **kwargs):
        observers = list(kwargs.get("observers") or [])
        observers.append(LightcurveObserver(worker))
        kwargs["observers"] = observers
        original_init(worker, pipeline, *args, **kwargs)
        if all(existing is not worker for existing in runtime.workers):
            runtime.workers.append(worker)

    instrumented_init.__lightcurve_instrumented__ = True
    PipelineWorker.__init__ = instrumented_init


def install_livekit_instrumentation() -> None:
    try:
        from livekit.agents import JobContext
        from livekit.agents.voice_assistant import VoiceAssistant
        from livekit import rtc
    except ImportError:
        logger.debug("livekit-agents is not installed; skipping LiveKit instrumentation.")
        return

    if os.getenv("LIGHTCURVE_AGENT_FRAMEWORK") is None and runtime.framework == "pipecat":
        runtime.framework = "livekit"
    if os.getenv("LIGHTCURVE_AGENT_NAME") is None and runtime.name == "Pipecat agent":
        runtime.name = "LiveKit agent"

    original_job_init = JobContext.__init__
    if not getattr(original_job_init, "__lightcurve_instrumented__", False):
        def instrumented_job_init(ctx, *args, **kwargs):
            original_job_init(ctx, *args, **kwargs)
            if all(existing is not ctx for existing in runtime.workers):
                runtime.workers.append(ctx)
            runtime.worker_loops[id(ctx)] = asyncio.get_running_loop()
        instrumented_job_init.__lightcurve_instrumented__ = True
        JobContext.__init__ = instrumented_job_init

    original_agent_init = VoiceAssistant.__init__
    if not getattr(original_agent_init, "__lightcurve_instrumented__", False):
        def instrumented_agent_init(agent, *args, **kwargs):
            original_agent_init(agent, *args, **kwargs)

            def get_capture_id():
                for ctx in runtime.workers:
                    if id(ctx) in runtime.worker_sessions:
                        return runtime.worker_sessions[id(ctx)]
                return None

            def add_event(capture_id, event_type, speaker, payload=None):
                if not payload:
                    payload = {}
                at_ms = int((time.monotonic() - runtime.capture_started.get(capture_id, time.monotonic())) * 1000)
                runtime.sequence += 1
                runtime.events.setdefault(capture_id, []).append({
                    "sequence": runtime.sequence,
                    "eventType": event_type,
                    "speaker": speaker,
                    "timestampMs": at_ms,
                    "payload": payload,
                })

            @agent.on("user_speech_committed")
            def on_user_speech_committed(msg):
                capture_id = get_capture_id()
                if capture_id:
                    text = msg.alternatives[0].text if getattr(msg, "alternatives", None) else getattr(msg, "text", "")
                    if text:
                        at_ms = int((time.monotonic() - runtime.capture_started.get(capture_id, time.monotonic())) * 1000)
                        runtime.transcripts.setdefault(capture_id, []).append({"speaker": "human", "text": text, "startedAtMs": at_ms})
                        add_event(capture_id, "transcript", "human", {"text": text})

            @agent.on("agent_speech_committed")
            def on_agent_speech_committed(msg):
                capture_id = get_capture_id()
                if capture_id:
                    text = getattr(msg, "text", "")
                    if text:
                        at_ms = int((time.monotonic() - runtime.capture_started.get(capture_id, time.monotonic())) * 1000)
                        runtime.transcripts.setdefault(capture_id, []).append({"speaker": "agent", "text": text, "startedAtMs": at_ms})
                        add_event(capture_id, "transcript", "agent", {"text": text})

            @agent.on("agent_started_speaking")
            def on_agent_started_speaking():
                capture_id = get_capture_id()
                if capture_id:
                    add_event(capture_id, "speech_started", "agent")

            @agent.on("agent_stopped_speaking")
            def on_agent_stopped_speaking():
                capture_id = get_capture_id()
                if capture_id:
                    add_event(capture_id, "speech_stopped", "agent")
                    if capture_id in runtime.bot_stopped_events and runtime.loop:
                        runtime.loop.call_soon_threadsafe(runtime.bot_stopped_events[capture_id].set)

            @agent.on("function_calls_collected")
            def on_function_calls_collected(calls):
                capture_id = get_capture_id()
                if capture_id:
                    for call in calls:
                        name = getattr(call, "function_info", getattr(call, "name", "unknown")).name if hasattr(getattr(call, "function_info", None), "name") else getattr(call, "name", "unknown")
                        add_event(capture_id, "tool_started", "agent", {"functionName": name})

            @agent.on("function_calls_finished")
            def on_function_calls_finished(calls):
                capture_id = get_capture_id()
                if capture_id:
                    for call in calls:
                        name = getattr(call, "function_info", getattr(call, "name", "unknown")).name if hasattr(getattr(call, "function_info", None), "name") else getattr(call, "name", "unknown")
                        add_event(capture_id, "tool_completed", "agent", {"functionName": name})

        instrumented_agent_init.__lightcurve_instrumented__ = True
        VoiceAssistant.__init__ = instrumented_agent_init

    original_capture_frame = rtc.AudioSource.capture_frame
    if not getattr(original_capture_frame, "__lightcurve_instrumented__", False):
        def instrumented_capture_frame(source, frame, *args, **kwargs):
            capture_id = None
            for ctx in runtime.workers:
                if id(ctx) in runtime.worker_sessions:
                    capture_id = runtime.worker_sessions[id(ctx)]
                    break
            
            if capture_id and not getattr(source, "_is_lightcurve_replay_source", False):
                audio_format = (frame.sample_rate, frame.num_channels)
                if capture_id not in runtime.agent_audio_format:
                    runtime.agent_audio_format[capture_id] = audio_format
                
                audio_data = frame.data.tobytes() if hasattr(frame.data, "tobytes") else bytes(frame.data)
                if runtime.agent_audio_format[capture_id] == audio_format and len(runtime.agent_audio.get(capture_id, b"")) < 50 * 1024 * 1024:
                    if capture_id not in runtime.agent_audio:
                        runtime.agent_audio[capture_id] = bytearray()
                    runtime.agent_audio[capture_id].extend(audio_data)
                    
                for output_track in list(runtime.output_tracks.get(capture_id, set())):
                    output_track.put_audio(audio_data, frame.sample_rate, frame.num_channels)
            
            return original_capture_frame(source, frame, *args, **kwargs)
            
        instrumented_capture_frame.__lightcurve_instrumented__ = True
        rtc.AudioSource.capture_frame = instrumented_capture_frame


def start() -> None:
    install_pipecat_instrumentation()
    install_livekit_instrumentation()
    if not runtime.api_key:
        logger.warning("Set LIGHTCURVE_API_KEY to enable Lightcurve.")
        return

    def run_background():
        asyncio.run(runtime.run())

    thread = threading.Thread(target=run_background, name="lightcurve-runtime", daemon=True)
    thread.start()
