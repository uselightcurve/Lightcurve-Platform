FROM alpine:3.22 AS model

RUN apk add --no-cache curl \
    && mkdir -p /models \
    && curl --fail --location --retry 5 \
      --output /models/qwen3-4b-q4_k_m.gguf \
      https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf

FROM ghcr.io/ggml-org/llama.cpp:server
COPY --from=model /models/qwen3-4b-q4_k_m.gguf /models/qwen3-4b-q4_k_m.gguf
