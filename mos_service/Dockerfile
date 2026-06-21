FROM ubuntu:22.04 AS visqol-builder

ARG VISQOL_VERSION=v3.3.3
ARG BAZEL_VERSION=5.1.0
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl git build-essential python3 python3-numpy \
    && curl -fsSL "https://github.com/bazelbuild/bazel/releases/download/${BAZEL_VERSION}/bazel-${BAZEL_VERSION}-linux-x86_64" -o /usr/local/bin/bazel \
    && chmod +x /usr/local/bin/bazel \
    && git clone --depth 1 --branch "${VISQOL_VERSION}" https://github.com/google/visqol.git /src/visqol \
    && cd /src/visqol \
    && bazel build :visqol -c opt \
    && mkdir -p /out \
    && cp -L bazel-bin/visqol /out/visqol \
    && cp "model/lattice_tcditugenmeetpackhref_ls2_nl60_lr12_bs2048_learn.005_ep2400_train1_7_raw.tflite" /out/

FROM python:3.11-slim

ARG DNSMOS_SHA256=269fbebdb513aa23cddfbb593542ecc540284a91849ac50516870e1ac78f6edd
RUN apt-get update && apt-get install -y --no-install-recommends libsndfile1 libgomp1 curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /opt/visqol /opt/dnsmos \
    && curl -fsSL "https://raw.githubusercontent.com/microsoft/DNS-Challenge/master/DNSMOS/DNSMOS/sig_bak_ovr.onnx" -o /opt/dnsmos/sig_bak_ovr.onnx \
    && echo "${DNSMOS_SHA256}  /opt/dnsmos/sig_bak_ovr.onnx" | sha256sum -c -

COPY --from=visqol-builder /out/visqol /opt/visqol/visqol
COPY --from=visqol-builder /out/lattice_tcditugenmeetpackhref_ls2_nl60_lr12_bs2048_learn.005_ep2400_train1_7_raw.tflite /opt/visqol/

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .

EXPOSE 8080
CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "1", "--threads", "4", "--timeout", "180", "app:app"]
