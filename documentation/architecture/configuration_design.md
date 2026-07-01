# Configuration Design (pydantic-settings)

## Overview & Architecture

Movientum employs a strict "Single Source of Truth" configuration pattern powered by `pydantic-settings`. All environment variables are validated and parsed upon application startup, ensuring that the app cannot boot if critical configuration (like database URLs or API keys) is missing or malformed.

`os.getenv()` is explicitly forbidden outside of the config layer.

---

## Code Structure & Detailed Logic

### The Settings Class (`backend/app/config.py`)
The configuration is defined in a Pydantic `BaseSettings` class, which automatically parses a local `.env` file (via `env_file=".env"`) or system environment variables.

```python
from pydantic_settings import BaseSettings
from pydantic import field_validator
from functools import lru_cache

class Settings(BaseSettings):
    # TMDB
    tmdb_api_key: str
    tmdb_read_access_token: str
    tmdb_base_url: str = "https://api.themoviedb.org/3"

    # Database
    database_url: str           # sync (psycopg2) for Alembic
    async_database_url: str     # asyncpg for FastAPI
    db_password: str

    # Redis & Celery
    redis_url: str
    celery_broker_url: str = ""
    celery_result_backend: str = ""

    # JWT
    jwt_secret_key: str
    jwt_algorithm: str = "HS256"
```

### Custom Validators & URL Cleaning
Upstash Redis URLs often contain connection arguments (like `ssl_cert_reqs`) that are incompatible with celery brokers or standard redis parsers. `field_validator` hooks are used to strip problematic query parameters on startup.

```python
    @field_validator("redis_url", mode="before")
    @classmethod
    def clean_redis_url(cls, v):
        if v and "?" in v:
            base, query = v.split("?", 1)
            params = [p for p in query.split("&") if not p.lower().startswith("ssl_cert_reqs=")]
            v = f"{base}?{'&'.join(params)}" if params else base
        return v
```

### Password Encoding Proxies
Because asyncpg fails to parse database URLs if the password contains URL-unsafe characters (like `#` or `@`), the Settings class provides `@property` getters to securely inject the URL-encoded password.

```python
    @property
    def safe_async_db_url(self) -> str:
        from urllib.parse import quote_plus
        encoded = quote_plus(self.db_password)
        return self.async_database_url.replace(self.db_password, encoded)
```

### Singleton Instantiation
To prevent re-parsing the `.env` file on every request, the settings are cached using `@lru_cache()`. 
```python
@lru_cache()
def get_settings() -> Settings:
    return Settings()

settings = get_settings()
```
Other modules simply import `settings` from `app.config`.

---

## Tables & Summaries

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `tmdb_api_key` / `tmdb_read_access_token` | Yes | Authentication for TMDB API ingestion. |
| `database_url` | Yes | Synchronous DB URL (psycopg2) for Alembic schema migrations. |
| `async_database_url` | Yes | Asynchronous DB URL (asyncpg) for live FastAPI runtime. |
| `db_password` | Yes | Raw DB password, used for URL-encoding injection. |
| `redis_url` | Yes | Upstash Redis connection URL (tls: `rediss://`). |
| `jwt_secret_key` | Yes | Secret used to sign auth tokens. |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | No | OpenTelemetry hook (parsed separately in `telemetry.py`). |

---

## Workflows & Lifecycles

### Config Load Workflow
```mermaid
flowchart TD
    A[FastAPI App Starts] --> B[config.py: get_settings()]
    B --> C[pydantic-settings reads .env / env vars]
    C --> D[Run field_validators (Clean Redis URL)]
    D --> E[Validate all types & required fields]
    E -->|Validation Fails| F[Crash App Immediately]
    E -->|Success| G[Return Settings Singleton]
```
