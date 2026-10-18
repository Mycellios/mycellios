FROM python:3.12-slim-bookworm@sha256:34386ef0cb081344d7ec1c103ba398e6e9f64e9ab3a1509accc92a4e24a07258
RUN apt-get update && apt-get install -y --no-install-recommends espeak-ng libsndfile1 \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir torch==2.8.0 --index-url https://download.pytorch.org/whl/cpu
WORKDIR /app
COPY python/requirements-kokoro.txt /app/requirements-kokoro.txt
RUN pip install --no-cache-dir -r /app/requirements-kokoro.txt
COPY python/distributed_runtime/kokoro_engine.py /app/distributed_runtime/kokoro_engine.py
ENV PYTHONPATH=/app HF_HOME=/cache/huggingface TIKTOKEN_CACHE_DIR=/cache/tiktoken \
    OMP_NUM_THREADS=2 MKL_NUM_THREADS=2 TOKENIZERS_PARALLELISM=false
RUN useradd --uid 10001 --create-home speech
USER 10001:10001
CMD ["python", "-m", "distributed_runtime.kokoro_engine"]
