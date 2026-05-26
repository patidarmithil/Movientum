"""
Movientum — SQLAlchemy ORM Models
All DB tables defined here. Alembic reads these to generate migrations.

Phase 1 tables: movies, genres, movie_genres, directors, movie_directors
Phase 3 tables: users, ratings, watch_history, watchlist, user_genre_preferences
"""
import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    Boolean, BigInteger, Column, Date, DateTime, Float,
    ForeignKey, Integer, String, Text, UniqueConstraint,
    CheckConstraint, Index, text
)
from sqlalchemy.dialects.postgresql import UUID, JSONB, TSVECTOR, ARRAY
from sqlalchemy.orm import DeclarativeBase, relationship


def utcnow():
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


# ═══════════════════════════════════════════════════════════════
# PHASE 1: Movie Catalog Tables
# ═══════════════════════════════════════════════════════════════

class Genre(Base):
    """TMDB genre lookup table. 19 genres total (fixed)."""
    __tablename__ = "genres"

    id = Column(Integer, primary_key=True)          # TMDB genre ID (use theirs)
    name = Column(String(100), nullable=False, unique=True)

    # Relationships
    movies = relationship("MovieGenre", back_populates="genre")
    user_preferences = relationship("UserGenrePreference", back_populates="genre")

    def __repr__(self):
        return f"<Genre id={self.id} name={self.name}>"


class Movie(Base):
    """
    Master movie catalog sourced from TMDB.
    TMDB movie ID used as primary key to avoid ID mismatch.
    """
    __tablename__ = "movies"

    id = Column(Integer, primary_key=True)              # TMDB movie ID
    title = Column(String(500), nullable=False)
    original_title = Column(String(500), nullable=True)
    overview = Column(Text, nullable=True)
    release_date = Column(Date, nullable=True)
    runtime = Column(Integer, nullable=True)            # minutes
    poster_path = Column(Text, nullable=True)           # TMDB relative path e.g. /abc.jpg
    backdrop_path = Column(Text, nullable=True)
    popularity = Column(Float, default=0.0)
    vote_average = Column(Float, default=0.0)
    vote_count = Column(Integer, default=0)
    adult = Column(Boolean, default=False)
    status = Column(String(50), nullable=True)          # Released, In Production, etc.
    budget = Column(BigInteger, default=0)
    revenue = Column(BigInteger, default=0)
    original_language = Column(String(10), nullable=True)  # ISO code: en, fr, ja
    imdb_id = Column(String(20), nullable=True)
    metadata_ = Column("metadata", JSONB, default=dict)    # flexible extra TMDB data
    search_vector = Column(TSVECTOR, nullable=True)         # Full-text search index
    fetched_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)

    # Relationships
    genres = relationship("MovieGenre", back_populates="movie", cascade="all, delete-orphan")
    directors = relationship("MovieDirector", back_populates="movie", cascade="all, delete-orphan")
    ratings = relationship("Rating", back_populates="movie")
    watch_histories = relationship("WatchHistory", back_populates="movie")
    watchlist_entries = relationship("Watchlist", back_populates="movie")

    # Indexes (defined at table level for compound indexes)
    __table_args__ = (
        Index("idx_movies_popularity", "popularity", postgresql_ops={"popularity": "DESC"}),
        Index("idx_movies_vote_average", "vote_average"),
        Index("idx_movies_release_date", "release_date"),
        Index("idx_movies_language", "original_language"),
        Index("idx_movies_fts", "search_vector", postgresql_using="gin"),
    )

    def __repr__(self):
        return f"<Movie id={self.id} title={self.title!r}>"


class MovieGenre(Base):
    """Junction table: Movie ↔ Genre (many-to-many)."""
    __tablename__ = "movie_genres"

    movie_id = Column(Integer, ForeignKey("movies.id", ondelete="CASCADE"), primary_key=True)
    genre_id = Column(Integer, ForeignKey("genres.id", ondelete="CASCADE"), primary_key=True)

    movie = relationship("Movie", back_populates="genres")
    genre = relationship("Genre", back_populates="movies")


class Director(Base):
    """Director profiles. TMDB person ID as primary key."""
    __tablename__ = "directors"

    id = Column(Integer, primary_key=True)              # TMDB person ID
    name = Column(String(255), nullable=False)
    biography = Column(Text, nullable=True)
    profile_path = Column(Text, nullable=True)
    birthday = Column(Date, nullable=True)
    place_of_birth = Column(String(255), nullable=True)
    tmdb_id = Column(Integer, unique=True, nullable=True)   # redundant but explicit

    movies = relationship("MovieDirector", back_populates="director", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Director id={self.id} name={self.name!r}>"


class MovieDirector(Base):
    """Junction table: Movie ↔ Director (many-to-many)."""
    __tablename__ = "movie_directors"

    movie_id = Column(Integer, ForeignKey("movies.id", ondelete="CASCADE"), primary_key=True)
    director_id = Column(Integer, ForeignKey("directors.id", ondelete="CASCADE"), primary_key=True)

    movie = relationship("Movie", back_populates="directors")
    director = relationship("Director", back_populates="movies")


# ═══════════════════════════════════════════════════════════════
# PHASE 3: User / Auth / Activity Tables (defined now for Alembic)
# ═══════════════════════════════════════════════════════════════

class User(Base):
    """All registered users. UUID primary key (prevents enumeration attacks)."""
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), nullable=False, unique=True)
    username = Column(String(100), nullable=False, unique=True)
    password_hash = Column(Text, nullable=False)        # bcrypt hash, never plaintext
    avatar_url = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)
    is_active = Column(Boolean, default=True)
    role = Column(String(20), default="user")           # user | admin

    # Relationships
    ratings = relationship("Rating", back_populates="user", cascade="all, delete-orphan")
    watch_histories = relationship("WatchHistory", back_populates="user", cascade="all, delete-orphan")
    watchlist_entries = relationship("Watchlist", back_populates="user", cascade="all, delete-orphan")
    genre_preferences = relationship("UserGenrePreference", back_populates="user", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_users_email", "email"),
        Index("idx_users_created_at", "created_at"),
    )

    def __repr__(self):
        return f"<User id={self.id} email={self.email!r}>"


class Rating(Base):
    """
    User ratings — 4-category breakdown (Story/Acting/Direction/Visuals) + Overall.
    Custom Movientum rating system, not TMDB ratings.
    """
    __tablename__ = "ratings"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    movie_id = Column(Integer, ForeignKey("movies.id", ondelete="CASCADE"), nullable=False)

    # Category scores (optional except overall)
    story_score = Column(Float, nullable=True)
    acting_score = Column(Float, nullable=True)
    direction_score = Column(Float, nullable=True)
    visuals_score = Column(Float, nullable=True)
    overall_score = Column(Float, nullable=False)       # Required

    review_text = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=True, onupdate=utcnow)

    user = relationship("User", back_populates="ratings")
    movie = relationship("Movie", back_populates="ratings")

    __table_args__ = (
        UniqueConstraint("user_id", "movie_id", name="uq_rating_user_movie"),
        CheckConstraint("overall_score >= 0 AND overall_score <= 10", name="chk_overall_score"),
        CheckConstraint("story_score IS NULL OR (story_score >= 0 AND story_score <= 10)", name="chk_story_score"),
        CheckConstraint("acting_score IS NULL OR (acting_score >= 0 AND acting_score <= 10)", name="chk_acting_score"),
        CheckConstraint("direction_score IS NULL OR (direction_score >= 0 AND direction_score <= 10)", name="chk_direction_score"),
        CheckConstraint("visuals_score IS NULL OR (visuals_score >= 0 AND visuals_score <= 10)", name="chk_visuals_score"),
        Index("idx_ratings_user_id", "user_id"),
        Index("idx_ratings_movie_id", "movie_id"),
        Index("idx_ratings_overall", "overall_score"),
    )

    def __repr__(self):
        return f"<Rating user={self.user_id} movie={self.movie_id} overall={self.overall_score}>"


class WatchHistory(Base):
    """Records movies a user marks as watched. One record per user-movie pair."""
    __tablename__ = "watch_history"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    movie_id = Column(Integer, ForeignKey("movies.id", ondelete="CASCADE"), nullable=False)
    watched_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)
    watch_source = Column(String(50), nullable=True)    # theater, netflix, etc.
    rewatched = Column(Boolean, default=False)

    user = relationship("User", back_populates="watch_histories")
    movie = relationship("Movie", back_populates="watch_histories")

    __table_args__ = (
        UniqueConstraint("user_id", "movie_id", name="uq_watch_user_movie"),
        Index("idx_watch_user_id", "user_id"),
        Index("idx_watch_watched_at", "user_id", "watched_at"),
    )

    def __repr__(self):
        return f"<WatchHistory user={self.user_id} movie={self.movie_id}>"


class Watchlist(Base):
    """Movies user plans to watch. One entry per user-movie pair."""
    __tablename__ = "watchlist"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    movie_id = Column(Integer, ForeignKey("movies.id", ondelete="CASCADE"), nullable=False)
    added_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)

    user = relationship("User", back_populates="watchlist_entries")
    movie = relationship("Movie", back_populates="watchlist_entries")

    __table_args__ = (
        UniqueConstraint("user_id", "movie_id", name="uq_watchlist_user_movie"),
        Index("idx_watchlist_user_id", "user_id"),
    )

    def __repr__(self):
        return f"<Watchlist user={self.user_id} movie={self.movie_id}>"


class UserGenrePreference(Base):
    """Explicit genre preferences set by user in profile settings."""
    __tablename__ = "user_genre_preferences"

    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    genre_id = Column(Integer, ForeignKey("genres.id", ondelete="CASCADE"), primary_key=True)
    weight = Column(Float, default=1.0)                 # Higher = more preferred

    user = relationship("User", back_populates="genre_preferences")
    genre = relationship("Genre", back_populates="user_preferences")

    def __repr__(self):
        return f"<UserGenrePref user={self.user_id} genre={self.genre_id} w={self.weight}>"
