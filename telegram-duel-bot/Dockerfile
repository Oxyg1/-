FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    DB_PATH=/data/duelbot.db

WORKDIR /app
COPY pyproject.toml README.md ./
COPY duelbot ./duelbot
RUN pip install . && useradd --system --uid 10001 duel && mkdir -p /data && chown duel /data

USER duel
VOLUME ["/data"]
CMD ["python", "-m", "duelbot"]
