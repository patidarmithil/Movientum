"""ratings_category_and_watch_service

Revision ID: a1b2c3d4e5f6
Revises: c2cbd085a5a6
Create Date: 2026-05-27 00:01:00.000000

Phase 3.3: Replace numeric score columns in ratings with category VARCHAR enum.
Categories: skip | timepass | go_for_it | perfection
Drops: story_score, acting_score, direction_score, visuals_score, overall_score,
       review_text, and associated check constraints + index.
Adds:  category (VARCHAR, NOT NULL after data migration), idx_ratings_category.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = 'c2cbd085a5a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Drop check constraints (must drop before dropping columns)
    op.drop_constraint('chk_overall_score',    'ratings', type_='check')
    op.drop_constraint('chk_story_score',      'ratings', type_='check')
    op.drop_constraint('chk_acting_score',     'ratings', type_='check')
    op.drop_constraint('chk_direction_score',  'ratings', type_='check')
    op.drop_constraint('chk_visuals_score',    'ratings', type_='check')

    # 2. Drop old numeric index
    op.drop_index('idx_ratings_overall', table_name='ratings')

    # 3. Drop numeric score columns and review_text
    op.drop_column('ratings', 'story_score')
    op.drop_column('ratings', 'acting_score')
    op.drop_column('ratings', 'direction_score')
    op.drop_column('ratings', 'visuals_score')
    op.drop_column('ratings', 'overall_score')
    op.drop_column('ratings', 'review_text')

    # 4. Add category column (nullable first so existing rows survive)
    op.add_column(
        'ratings',
        sa.Column('category', sa.String(length=20), nullable=True)
    )

    # 5. Back-fill any surviving rows with a default category
    op.execute("UPDATE ratings SET category = 'timepass' WHERE category IS NULL")

    # 6. Make category NOT NULL now that all rows have a value
    op.alter_column('ratings', 'category', nullable=False)

    # 7. Add check constraint for valid categories
    op.create_check_constraint(
        'chk_rating_category',
        'ratings',
        "category IN ('skip', 'timepass', 'go_for_it', 'perfection')",
    )

    # 8. Add index on category for distribution queries
    op.create_index('idx_ratings_category', 'ratings', ['category'], unique=False)


def downgrade() -> None:
    # Remove new category infrastructure
    op.drop_index('idx_ratings_category', table_name='ratings')
    op.drop_constraint('chk_rating_category', 'ratings', type_='check')
    op.drop_column('ratings', 'category')

    # Re-add numeric score columns
    op.add_column('ratings', sa.Column('review_text',      sa.Text(),  nullable=True))
    op.add_column('ratings', sa.Column('visuals_score',    sa.Float(), nullable=True))
    op.add_column('ratings', sa.Column('direction_score',  sa.Float(), nullable=True))
    op.add_column('ratings', sa.Column('acting_score',     sa.Float(), nullable=True))
    op.add_column('ratings', sa.Column('story_score',      sa.Float(), nullable=True))
    op.add_column('ratings', sa.Column('overall_score',    sa.Float(), nullable=False, server_default='0'))

    # Re-add constraints
    op.create_check_constraint('chk_overall_score',    'ratings', 'overall_score >= 0 AND overall_score <= 10')
    op.create_check_constraint('chk_story_score',      'ratings', 'story_score IS NULL OR (story_score >= 0 AND story_score <= 10)')
    op.create_check_constraint('chk_acting_score',     'ratings', 'acting_score IS NULL OR (acting_score >= 0 AND acting_score <= 10)')
    op.create_check_constraint('chk_direction_score',  'ratings', 'direction_score IS NULL OR (direction_score >= 0 AND direction_score <= 10)')
    op.create_check_constraint('chk_visuals_score',    'ratings', 'visuals_score IS NULL OR (visuals_score >= 0 AND visuals_score <= 10)')

    op.create_index('idx_ratings_overall', 'ratings', ['overall_score'], unique=False)
