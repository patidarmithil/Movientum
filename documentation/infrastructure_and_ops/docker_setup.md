# Docker Setup

The backend ships as one Docker image (`backend/Dockerfile`). The same image runs the API, a Celery worker, or the Celery scheduler, depending on the command.

## Dockerfile in short

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt   # cached layer
ARG CODE_VERSION=1                                   # changes every build
COPY . /app
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
```

- Dependencies are installed **before** code is copied, so editing Python does not re-run `pip install`.
- `CODE_VERSION` is set to a random value at build time, forcing Docker to copy fresh code.
- The image uses Python 3.11; local development uses 3.13. Keep code compatible with both.

## Local stack (`docker-compose.yml`)

| Service | Command | Purpose |
|---|---|---|
| `backend` | `uvicorn app.main:app --reload` | API on port 8000, code mounted for hot reload |
| `celery_worker` | `celery -A app.celery_app worker` | Runs queued jobs |
| `celery_beat` | `celery -A app.celery_app beat` | Scheduler — run exactly one |

All three read `backend/.env`.

```bash
docker-compose up
```

## Without Docker

```bash
cd backend
python -m venv venv && venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

## Deploying

```bash
docker build --build-arg CODE_VERSION=%RANDOM% -t patidarmithil/movientum-backend:latest .
docker push patidarmithil/movientum-backend:latest
```

Azure App Service (primary) and Render (backup) pull this image. Steps are in `backend/steps.txt`.

## Scheduled jobs (Celery beat, IST)

| Time | Job |
|---|---|
| 03:00 | TMDB movie sync |
| 03:30 | Ranker retrain |
| 03:45 | News title index (for linking articles to titles) |
| 04:00 | New-episode check → notifications |
| Every 3 h | Trailer index per region (staggered 0/10/20/30 min) |

On free hosts beat is not always running, so every job can also be started from the admin panel. News fetching has **no** schedule — admin button only.
