"""
Alembic env.py — Migration Environment
Reads DATABASE_URL from app/config.py (sync psycopg2 connection to Supabase).
Imports ORM Base.metadata so autogenerate can diff models vs DB.
"""
import os
import sys
from logging.config import fileConfig
from sqlalchemy import engine_from_config, pool
from alembic import context

# Add backend root to path so app module is importable
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

# Load .env before importing app config
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from app.config import settings
from app.db.orm_models import Base

# ── Alembic Config Object ─────────────────────────────────────
config = context.config

# Override sqlalchemy.url from settings (sync URL for psycopg2)
# Escape % → %% so configparser doesn't treat percent-encoded chars as interpolation
_safe_url = settings.safe_sync_db_url.replace("%", "%%")
config.set_main_option("sqlalchemy.url", _safe_url)

# Logging setup from alembic.ini
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Target metadata — Alembic diffs this vs current DB state
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """
    Run migrations in 'offline' mode — generates SQL without a live connection.
    Useful for review/dry-run.
    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,      # detect column type changes
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """
    Run migrations in 'online' mode — connects to DB and applies changes.
    This is the default when running: alembic upgrade head
    """
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,    # don't pool in migration context
        connect_args={
            "sslmode": "require",   # Supabase requires SSL
        },
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
