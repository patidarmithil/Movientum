"""add_type_column_to_movies

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-05-27 12:47:00.000000

Improvement 1.7: Add `type` column to movies table.
Values: 'movie' (default) | 'tv'
Allows TV show stubs to share the same table so FK constraints
on ratings/watchlist/watch_history remain valid.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'movies',
        sa.Column(
            'type',
            sa.String(10),
            nullable=False,
            server_default='movie',
        )
    )
    op.create_index('idx_movies_type', 'movies', ['type'])


def downgrade() -> None:
    op.drop_index('idx_movies_type', table_name='movies')
    op.drop_column('movies', 'type')
