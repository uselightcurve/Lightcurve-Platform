import io
import wave

import numpy as np


def mono_audio(content: bytes):
    with wave.open(io.BytesIO(content), "rb") as wav:
        channels = wav.getnchannels()
        sample_width = wav.getsampwidth()
        sample_rate = wav.getframerate()
        frames = wav.readframes(wav.getnframes())
    if sample_width == 1:
        audio = (np.frombuffer(frames, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
    elif sample_width == 2:
        audio = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
    elif sample_width == 4:
        audio = np.frombuffer(frames, dtype="<i4").astype(np.float32) / 2147483648.0
    else:
        raise ValueError("Audio must use 8-bit, 16-bit, or 32-bit PCM WAV")
    if channels > 1:
        audio = np.mean(audio.reshape(-1, channels), axis=1)
    if audio.size == 0 or sample_rate < 8000:
        raise ValueError("Audio is empty or has an unsupported sample rate")
    return audio, sample_rate


def pitch_values(audio: np.ndarray, sample_rate: int):
    frame_size = max(256, int(sample_rate * 0.04))
    hop = max(128, int(sample_rate * 0.02))
    min_lag = max(1, int(sample_rate / 400))
    max_lag = min(frame_size - 1, int(sample_rate / 70))
    values = []
    for start in range(0, max(1, len(audio) - frame_size), hop):
        frame = audio[start:start + frame_size]
        frame = frame - np.mean(frame)
        energy = float(np.sqrt(np.mean(frame * frame)))
        if energy < 0.008:
            continue
        correlation = np.correlate(frame, frame, mode="full")[frame_size - 1:]
        if correlation[0] <= 0:
            continue
        window = correlation[min_lag:max_lag + 1]
        lag_offset = int(np.argmax(window))
        peak = float(window[lag_offset] / correlation[0])
        if peak < 0.28:
            continue
        lag = min_lag + lag_offset
        values.append(sample_rate / lag)
    return np.asarray(values, dtype=np.float32)


def analyze_audio(content: bytes):
    audio, sample_rate = mono_audio(content)
    frame_size = max(256, int(sample_rate * 0.025))
    hop = max(128, int(sample_rate * 0.01))
    rms = []
    for start in range(0, max(1, len(audio) - frame_size), hop):
        frame = audio[start:start + frame_size]
        rms.append(float(np.sqrt(np.mean(frame * frame))))
    rms_values = np.asarray(rms or [0.0], dtype=np.float32)
    threshold = max(0.006, float(np.percentile(rms_values, 65)) * 0.2)
    pitches = pitch_values(audio, sample_rate)
    duration_seconds = len(audio) / sample_rate
    return {
        "durationMs": round(duration_seconds * 1000),
        "rmsMean": round(float(np.mean(rms_values)), 6),
        "rmsVariation": round(float(np.std(rms_values)), 6),
        "pauseRatio": round(float(np.mean(rms_values < threshold)), 4),
        "voicedRatio": round(float(len(pitches) / max(1, len(rms_values))), 4),
        "pitchMeanHz": round(float(np.mean(pitches)), 2) if len(pitches) else None,
        "pitchVariationHz": round(float(np.std(pitches)), 2) if len(pitches) else None,
        "pitchRangeHz": round(float(np.percentile(pitches, 90) - np.percentile(pitches, 10)), 2) if len(pitches) >= 5 else None,
        "confidence": round(min(0.95, 0.45 + min(0.4, duration_seconds / 30) + (0.1 if len(pitches) >= 5 else 0)), 3),
    }

