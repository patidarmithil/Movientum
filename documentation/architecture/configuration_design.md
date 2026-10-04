# Configuration

All settings are read in one place: `backend/app/config.py`. It defines a `Settings` class with `pydantic-settings`, which reads `backend/.env` (or real environment variables) and checks types when the app starts. If a required value is missing, the app refuses to boot instead of failing later.

## How to use it

```python
from app.config import settings

settings.tmdb_api_key
settings.safe_async_db_url
```

**Never call `os.getenv()` anywhere else.** One source of truth means one place to look when a value is wrong.

## Things the config fixes for you

- **Database password encoding.** The Supabase password has characters like `@` and `#` that break URL parsing. `safe_async_db_url` and `safe_sync_db_url` return the URL with the password encoded.
- **Redis URL cleanup.** Upstash URLs can carry `ssl_cert_reqs=...` query options that Celery rejects. A validator strips them.
- **Cached instance.** `settings` is built once and imported everywhere.

## Main settings

| Area | Keys | Notes |
|---|---|---|
| TMDB | `tmdb_api_key`, `tmdb_read_access_token` | All title data |
| Database | `database_url`, `async_database_url`, `db_password` | Sync for Alembic, async for the app |
| Redis / Celery | `redis_url`, `celery_broker_url`, `celery_result_backend` | Upstash, `rediss://` (TLS) |
| Auth | `jwt_secret_key`, `jwt_algorithm`, `access_token_expire_minutes` (2880 = 48 h), `refresh_token_expire_minutes` (10080 = 7 days), `google_client_id` | |
| AI | `gemini_api_key`, `groq_api_key` | Groq is the fallback when Gemini fails |
| News | NewsAPI, Currents, ApiTube keys | Used only by the admin-triggered daily fetch |
| Ops | `cron_secret_token`, `allowed_origins`, `debug`, `app_env`, Grafana URLs | `/docs` is only served when `debug=true` |

The full list with placeholders is in `backend/.env.example`.

## Frontend settings

`frontend/.env`:
- `VITE_API_URL` — main backend.
- `VITE_API_URL_SECONDARY` — backup backend (Render).
- `VITE_GOOGLE_CLIENT_ID` — enables the Google sign-in button.

Both `.env` files are gitignored.
