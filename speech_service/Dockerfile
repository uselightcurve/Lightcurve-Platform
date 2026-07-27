FROM ghcr.io/speaches-ai/speaches:latest-cpu

# Speaches v0.8 discovers models in the standard Hugging Face cache.
RUN uv tool run --from huggingface_hub hf download Systran/faster-distil-whisper-large-v3 \
    && uv tool run --from huggingface_hub hf download speaches-ai/Kokoro-82M-v1.0-ONNX
