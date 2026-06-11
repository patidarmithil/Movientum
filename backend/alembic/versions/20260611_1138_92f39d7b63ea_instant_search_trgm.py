"""instant_search_trgm

Revision ID: 92f39d7b63ea
Revises: 46ed982502d7
Create Date: 2026-06-11 11:38:11.453283

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '92f39d7b63ea'
down_revision: Union[str, None] = '46ed982502d7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Enable pg_trgm extension if not already present
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm;")
    
    # Create GIN index for fast trigram search on lower(title)
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_movies_title_trgm "
        "ON movies USING GIN (lower(title) gin_trgm_ops);"
    )


def downgrade() -> None:
    # Drop the index
    op.execute("DROP INDEX IF EXISTS idx_movies_title_trgm;")
    
    # Optionally drop the extension, but usually better to leave it 
    # as other things might depend on it.
    # op.execute("DROP EXTENSION IF EXISTS pg_trgm;")
