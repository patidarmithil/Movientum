"""remove_negative_id_hack

Revision ID: 8da847a54892
Revises: 9d40aa5fc1a9
Create Date: 2026-06-24 20:27:47.053886

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8da847a54892'
down_revision: Union[str, None] = '9d40aa5fc1a9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Ensure movies have a type before we propagate it
    op.execute("UPDATE movies SET type = 'movie' WHERE type IS NULL")

    # 1. Add media_type to referencing tables
    for table, col in [
        ("movie_genres", "movie_id"),
        ("movie_directors", "movie_id"),
        ("ratings", "movie_id"),
        ("watch_history", "movie_id"),
        ("watchlist", "movie_id"),
        ("watchlist_items", "movie_id"),
        ("movie_ratings", "id"),
        ("tv_ratings", "id"),
    ]:
        op.add_column(table, sa.Column('media_type', sa.String(length=10), nullable=True))

    # 2. Drop existing foreign keys
    op.execute("ALTER TABLE movie_genres DROP CONSTRAINT IF EXISTS movie_genres_movie_id_fkey")
    op.execute("ALTER TABLE movie_directors DROP CONSTRAINT IF EXISTS movie_directors_movie_id_fkey")
    op.execute("ALTER TABLE ratings DROP CONSTRAINT IF EXISTS ratings_movie_id_fkey")
    op.execute("ALTER TABLE watch_history DROP CONSTRAINT IF EXISTS watch_history_movie_id_fkey")
    op.execute("ALTER TABLE watchlist DROP CONSTRAINT IF EXISTS watchlist_movie_id_fkey")
    op.execute("ALTER TABLE watchlist_items DROP CONSTRAINT IF EXISTS watchlist_items_movie_id_fkey")
    op.execute("ALTER TABLE movie_ratings DROP CONSTRAINT IF EXISTS movie_ratings_id_fkey")
    op.execute("ALTER TABLE tv_ratings DROP CONSTRAINT IF EXISTS tv_ratings_id_fkey")

    # 3. Drop existing Primary Keys of referencing tables
    op.execute("ALTER TABLE movie_genres DROP CONSTRAINT IF EXISTS movie_genres_pkey")
    op.execute("ALTER TABLE movie_directors DROP CONSTRAINT IF EXISTS movie_directors_pkey")
    op.execute("ALTER TABLE movie_ratings DROP CONSTRAINT IF EXISTS movie_ratings_pkey")
    op.execute("ALTER TABLE tv_ratings DROP CONSTRAINT IF EXISTS tv_ratings_pkey")

    # Drop unique constraints that cause issues during ABS
    op.execute("ALTER TABLE ratings DROP CONSTRAINT IF EXISTS uq_rating_user_movie")
    op.execute("ALTER TABLE watch_history DROP CONSTRAINT IF EXISTS uq_watch_user_movie")
    op.execute("ALTER TABLE watchlist DROP CONSTRAINT IF EXISTS uq_watchlist_user_movie")
    op.execute("ALTER TABLE watchlist_items DROP CONSTRAINT IF EXISTS uq_wlitem_coll_movie")

    # 4. Update media_type and normalize movie_id
    for table, col in [
        ("movie_genres", "movie_id"),
        ("movie_directors", "movie_id"),
        ("ratings", "movie_id"),
        ("watch_history", "movie_id"),
        ("watchlist", "movie_id"),
        ("watchlist_items", "movie_id"),
        ("movie_ratings", "id"),
        ("tv_ratings", "id"),
    ]:
        if table == "tv_ratings":
            op.execute(f"UPDATE {table} SET media_type = 'tv'")
        elif table == "movie_ratings":
            op.execute(f"UPDATE {table} SET media_type = 'movie'")
        else:
            op.execute(f"UPDATE {table} SET media_type = m.type FROM movies m WHERE {table}.{col} = m.id")
            # If there are orphaned rows, they will have media_type = NULL, let's delete them or force 'movie'
            op.execute(f"UPDATE {table} SET media_type = 'movie' WHERE media_type IS NULL")

        op.alter_column(table, 'media_type', nullable=False)
        op.execute(f"UPDATE {table} SET {col} = ABS({col})")

    # Normalize movies table
    op.execute("ALTER TABLE movies DROP CONSTRAINT IF EXISTS movies_pkey CASCADE")
    
    # Delete negative IDs where a positive ID with type='tv' already exists!
    op.execute("""
        DELETE FROM movies 
        WHERE id < 0 
        AND ABS(id) IN (SELECT id FROM movies WHERE id > 0 AND type = 'tv')
    """)
    # Now update the rest
    op.execute("UPDATE movies SET type = 'tv', id = ABS(id) WHERE id < 0")
    
    # Deduplicate movies table based on (id, type)
    op.execute("""
        DELETE FROM movies a USING movies b
        WHERE a.id = b.id AND a.type = b.type AND a.ctid > b.ctid
    """)

    # Deduplicate referencing tables
    op.execute("""
        DELETE FROM watch_history a USING watch_history b
        WHERE a.user_id = b.user_id AND a.movie_id = b.movie_id AND a.media_type = b.media_type AND a.ctid > b.ctid
    """)
    op.execute("""
        DELETE FROM watchlist a USING watchlist b
        WHERE a.user_id = b.user_id AND a.movie_id = b.movie_id AND a.media_type = b.media_type AND a.ctid > b.ctid
    """)
    op.execute("""
        DELETE FROM watchlist_items a USING watchlist_items b
        WHERE a.collection_id = b.collection_id AND a.movie_id = b.movie_id AND a.media_type = b.media_type AND a.ctid > b.ctid
    """)
    op.execute("""
        DELETE FROM ratings a USING ratings b
        WHERE a.user_id = b.user_id AND a.movie_id = b.movie_id AND a.media_type = b.media_type AND a.ctid > b.ctid
    """)
    op.execute("""
        DELETE FROM movie_genres a USING movie_genres b
        WHERE a.movie_id = b.movie_id AND a.media_type = b.media_type AND a.genre_id = b.genre_id AND a.ctid > b.ctid
    """)
    op.execute("""
        DELETE FROM movie_directors a USING movie_directors b
        WHERE a.movie_id = b.movie_id AND a.media_type = b.media_type AND a.director_id = b.director_id AND a.ctid > b.ctid
    """)
    op.execute("""
        DELETE FROM movie_ratings a USING movie_ratings b
        WHERE a.id = b.id AND a.media_type = b.media_type AND a.ctid > b.ctid
    """)
    op.execute("""
        DELETE FROM tv_ratings a USING tv_ratings b
        WHERE a.id = b.id AND a.media_type = b.media_type AND a.ctid > b.ctid
    """)
    
    # Clean up any orphaned rows that might still exist if movies were deleted
    # before we create foreign keys
    op.execute("DELETE FROM movie_genres WHERE NOT EXISTS (SELECT 1 FROM movies WHERE movies.id = movie_genres.movie_id AND movies.type = movie_genres.media_type)")
    op.execute("DELETE FROM movie_directors WHERE NOT EXISTS (SELECT 1 FROM movies WHERE movies.id = movie_directors.movie_id AND movies.type = movie_directors.media_type)")
    op.execute("DELETE FROM ratings WHERE NOT EXISTS (SELECT 1 FROM movies WHERE movies.id = ratings.movie_id AND movies.type = ratings.media_type)")
    op.execute("DELETE FROM watch_history WHERE NOT EXISTS (SELECT 1 FROM movies WHERE movies.id = watch_history.movie_id AND movies.type = watch_history.media_type)")
    op.execute("DELETE FROM watchlist WHERE NOT EXISTS (SELECT 1 FROM movies WHERE movies.id = watchlist.movie_id AND movies.type = watchlist.media_type)")
    op.execute("DELETE FROM watchlist_items WHERE NOT EXISTS (SELECT 1 FROM movies WHERE movies.id = watchlist_items.movie_id AND movies.type = watchlist_items.media_type)")
    op.execute("DELETE FROM movie_ratings WHERE NOT EXISTS (SELECT 1 FROM movies WHERE movies.id = movie_ratings.id AND movies.type = movie_ratings.media_type)")
    op.execute("DELETE FROM tv_ratings WHERE NOT EXISTS (SELECT 1 FROM movies WHERE movies.id = tv_ratings.id AND movies.type = tv_ratings.media_type)")

    # 5. Add composite primary key to movies
    op.create_primary_key('movies_pkey', 'movies', ['id', 'type'])
    
    # 6. Add new primary keys to referencing tables
    op.create_primary_key('movie_genres_pkey', 'movie_genres', ['movie_id', 'media_type', 'genre_id'])
    op.create_primary_key('movie_directors_pkey', 'movie_directors', ['movie_id', 'media_type', 'director_id'])
    op.create_primary_key('movie_ratings_pkey', 'movie_ratings', ['id', 'media_type'])
    op.create_primary_key('tv_ratings_pkey', 'tv_ratings', ['id', 'media_type'])

    # 7. Recreate foreign keys
    op.create_foreign_key('movie_genres_movie_id_fkey', 'movie_genres', 'movies', ['movie_id', 'media_type'], ['id', 'type'], ondelete='CASCADE')
    op.create_foreign_key('movie_directors_movie_id_fkey', 'movie_directors', 'movies', ['movie_id', 'media_type'], ['id', 'type'], ondelete='CASCADE')
    op.create_foreign_key('ratings_movie_id_fkey', 'ratings', 'movies', ['movie_id', 'media_type'], ['id', 'type'], ondelete='CASCADE')
    op.create_foreign_key('watch_history_movie_id_fkey', 'watch_history', 'movies', ['movie_id', 'media_type'], ['id', 'type'], ondelete='CASCADE')
    op.create_foreign_key('watchlist_movie_id_fkey', 'watchlist', 'movies', ['movie_id', 'media_type'], ['id', 'type'], ondelete='CASCADE')
    op.create_foreign_key('watchlist_items_movie_id_fkey', 'watchlist_items', 'movies', ['movie_id', 'media_type'], ['id', 'type'], ondelete='CASCADE')
    op.create_foreign_key('movie_ratings_id_fkey', 'movie_ratings', 'movies', ['id', 'media_type'], ['id', 'type'], ondelete='CASCADE')
    op.create_foreign_key('tv_ratings_id_fkey', 'tv_ratings', 'movies', ['id', 'media_type'], ['id', 'type'], ondelete='CASCADE')

    # Update unique indexes for related tables
    op.create_unique_constraint('uq_rating_user_movie', 'ratings', ['user_id', 'movie_id', 'media_type'])
    op.create_unique_constraint('uq_watch_user_movie', 'watch_history', ['user_id', 'movie_id', 'media_type'])
    op.create_unique_constraint('uq_watchlist_user_movie', 'watchlist', ['user_id', 'movie_id', 'media_type'])
    op.create_unique_constraint('uq_wlitem_coll_movie', 'watchlist_items', ['collection_id', 'movie_id', 'media_type'])


def downgrade() -> None:
    pass
