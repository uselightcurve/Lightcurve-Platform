FROM ubuntu:22.04 AS visqol-builder

ARG VISQOL_VERSION=v3.3.3
ARG BAZEL_VERSION=5.1.0
ARG TARGETARCH
COPY visqol-system-armadillo.patch /tmp/visqol-system-armadillo.patch
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl git build-essential python3 python3-numpy libarmadillo-dev patch \
    && case "${TARGETARCH:-amd64}" in amd64) BAZEL_ARCH=x86_64 ;; arm64) BAZEL_ARCH=arm64 ;; *) echo "Unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; esac \
    && curl -fsSL "https://github.com/bazelbuild/bazel/releases/download/${BAZEL_VERSION}/bazel-${BAZEL_VERSION}-linux-${BAZEL_ARCH}" -o /usr/local/bin/bazel \
    && chmod +x /usr/local/bin/bazel \
    && mkdir -p /opt/armadillo/include \
    && cp -a /usr/include/armadillo /usr/include/armadillo_bits /opt/armadillo/include/ \
    && git clone --depth 1 --branch "${VISQOL_VERSION}" https://github.com/google/visqol.git /src/visqol \
    && cd /src/visqol \
    && patch -p1 < /tmp/visqol-system-armadillo.patch \
    && sed -i '/d856ea58c18998997bcae6689784d2d3eeb5daf1379d569fddc277fe046a996b/d; /strip_prefix = "armadillo-9.860.2"/d; /sourceforge.net\/projects\/arma\/files\/armadillo-9.860.2.tar.xz/d' WORKSPACE \
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
CMD ["sh", "-c", "gunicorn --bind 0.0.0.0:${PORT:-8080} --workers 1 --threads 4 --timeout 180 app:app"]
