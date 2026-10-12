# syntax=docker/dockerfile:1
# Single deployable image: FastAPI API + built React app (modular monolith, FSD D3).
FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.13-slim AS app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    UPM_STATIC_DIR=/app/static UPM_STORAGE_DIR=/data/storage
WORKDIR /app
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./
COPY --from=web /web/dist ./static
RUN useradd --system --uid 10001 upm && mkdir -p /data/storage && chown -R upm /data
USER upm
EXPOSE 8000
# Migrations run as a separate, controlled step (see docker-compose `migrate`), not on every start.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
