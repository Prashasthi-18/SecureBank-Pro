# ---- SecureBank Pro: small, non-root, read-only-friendly image ----
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DATABASE_PATH=/data/securebank.db

WORKDIR /app
RUN groupadd --system bank && useradd --system --gid bank --home /app bank \
    && mkdir -p /data && chown bank:bank /data

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY --chown=bank:bank app ./app
COPY --chown=bank:bank run.py .

USER bank
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/login')" || exit 1

# One worker keeps the in-memory rate limiter consistent; threads handle concurrency.
CMD ["gunicorn", "--bind", "0.0.0.0:8000", "--workers", "1", "--threads", "8", "--access-logfile", "-", "run:app"]
