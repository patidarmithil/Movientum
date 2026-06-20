"""add_watchlist_collections_and_items

Revision ID: 8bb951367160
Revises: 5637cb3dd0a8
Create Date: 2026-06-19 14:00:40.200502

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '8bb951367160'
down_revision: Union[str, None] = '5637cb3dd0a8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # New tables for multi-watchlist system only
    op.create_table(
        'watchlist_collections',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('idx_wlcoll_user_id', 'watchlist_collections', ['user_id'], unique=False)
    op.create_index('idx_wlcoll_user_created', 'watchlist_collections', ['user_id', 'created_at'], unique=False)

    op.create_table(
        'watchlist_items',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('collection_id', sa.UUID(), nullable=False),
        sa.Column('movie_id', sa.Integer(), nullable=False),
        sa.Column('added_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['collection_id'], ['watchlist_collections.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['movie_id'], ['movies.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('collection_id', 'movie_id', name='uq_wlitem_coll_movie'),
    )
    op.create_index('idx_wlitem_collection_id', 'watchlist_items', ['collection_id'], unique=False)
    op.create_index('idx_wlitem_collection_added', 'watchlist_items', ['collection_id', 'added_at'], unique=False)


def downgrade() -> None:
    op.drop_index('idx_wlitem_collection_added', table_name='watchlist_items')
    op.drop_index('idx_wlitem_collection_id', table_name='watchlist_items')
    op.drop_table('watchlist_items')
    op.drop_index('idx_wlcoll_user_created', table_name='watchlist_collections')
    op.drop_index('idx_wlcoll_user_id', table_name='watchlist_collections')
    op.drop_table('watchlist_collections')
