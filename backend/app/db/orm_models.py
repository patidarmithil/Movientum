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
    CheckConstraint, Index, text, ForeignKeyConstraint
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
    type = Column(String(10), primary_key=True, nullable=False, default='movie', server_default='movie')  # 'movie' | 'tv'
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

    movie_id = Column(Integer, primary_key=True)
    media_type = Column(String(10), primary_key=True, default='movie', server_default='movie')
    genre_id = Column(Integer, ForeignKey("genres.id", ondelete="CASCADE"), primary_key=True)

    __table_args__ = (
        ForeignKeyConstraint(["movie_id", "media_type"], ["movies.id", "movies.type"], ondelete="CASCADE"),
    )

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

    movie_id = Column(Integer, primary_key=True)
    media_type = Column(String(10), primary_key=True, default='movie', server_default='movie')
    director_id = Column(Integer, ForeignKey("directors.id", ondelete="CASCADE"), primary_key=True)

    __table_args__ = (
        ForeignKeyConstraint(["movie_id", "media_type"], ["movies.id", "movies.type"], ondelete="CASCADE"),
    )

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
    bio = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)
    is_active = Column(Boolean, default=True)
    role = Column(String(20), default="user")           # user | admin

    # Relationships
    ratings = relationship("Rating", back_populates="user", cascade="all, delete-orphan")
    watch_histories = relationship("WatchHistory", back_populates="user", cascade="all, delete-orphan")
    watchlist_entries = relationship("Watchlist", back_populates="user", cascade="all, delete-orphan")
    genre_preferences = relationship("UserGenrePreference", back_populates="user", cascade="all, delete-orphan")
    click_histories = relationship("ClickHistory", back_populates="user", cascade="all, delete-orphan")
    watchlist_collections = relationship("WatchlistCollection", back_populates="user", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_users_email", "email"),
        Index("idx_users_created_at", "created_at"),
    )

    def __repr__(self):
        return f"<User id={self.id} email={self.email!r}>"


class Rating(Base):
    """
    User ratings — single category label per user-movie pair.
    Phase 3.3: category-based system (no numeric scores).
    Categories: skip | timepass | go_for_it | perfection
    """
    __tablename__ = "ratings"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    movie_id = Column(Integer, nullable=False)
    media_type = Column(String(10), nullable=False, default='movie', server_default='movie')

    # Category enum: skip | timepass | go_for_it | perfection
    category = Column(String(20), nullable=False)

    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=True, onupdate=utcnow)

    user = relationship("User", back_populates="ratings")
    movie = relationship("Movie", back_populates="ratings")

    __table_args__ = (
        ForeignKeyConstraint(["movie_id", "media_type"], ["movies.id", "movies.type"], ondelete="CASCADE"),
        UniqueConstraint("user_id", "movie_id", "media_type", name="uq_rating_user_movie"),
        CheckConstraint(
            "category IN ('skip', 'timepass', 'go_for_it', 'perfection')",
            name="chk_rating_category",
        ),
        Index("idx_ratings_user_id", "user_id"),
        Index("idx_ratings_movie_id", "movie_id", "media_type"),
        Index("idx_ratings_category", "category"),
    )

    def __repr__(self):
        return f"<Rating user={self.user_id} movie={self.movie_id} category={self.category}>"


class WatchHistory(Base):
    """Records movies a user marks as watched. One record per user-movie pair."""
    __tablename__ = "watch_history"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    movie_id = Column(Integer, nullable=False)
    media_type = Column(String(10), nullable=False, default='movie', server_default='movie')
    watched_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)
    watch_source = Column(String(50), nullable=True)    # theater, netflix, etc.
    rewatched = Column(Boolean, default=False)

    user = relationship("User", back_populates="watch_histories")
    movie = relationship("Movie", back_populates="watch_histories")

    __table_args__ = (
        ForeignKeyConstraint(["movie_id", "media_type"], ["movies.id", "movies.type"], ondelete="CASCADE"),
        UniqueConstraint("user_id", "movie_id", "media_type", name="uq_watch_user_movie"),
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
    movie_id = Column(Integer, nullable=False)
    media_type = Column(String(10), nullable=False, default='movie', server_default='movie')
    added_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)

    user = relationship("User", back_populates="watchlist_entries")
    movie = relationship("Movie", back_populates="watchlist_entries")

    __table_args__ = (
        ForeignKeyConstraint(["movie_id", "media_type"], ["movies.id", "movies.type"], ondelete="CASCADE"),
        UniqueConstraint("user_id", "movie_id", "media_type", name="uq_watchlist_user_movie"),
        Index("idx_watchlist_user_id", "user_id"),
    )

    def __repr__(self):
        return f"<Watchlist user={self.user_id} movie={self.movie_id}>"


# ═══════════════════════════════════════════════════════════════
# Multi-Watchlist System: Collections + Items
# ═══════════════════════════════════════════════════════════════

class WatchlistCollection(Base):
    """Named watchlist collection owned by a user."""
    __tablename__ = "watchlist_collections"

    id          = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id     = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name        = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    created_at  = Column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at  = Column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)

    items = relationship("WatchlistItem", back_populates="collection", cascade="all, delete-orphan",
                         order_by="WatchlistItem.added_at.desc()")
    user  = relationship("User", back_populates="watchlist_collections")

    __table_args__ = (
        Index("idx_wlcoll_user_id", "user_id"),
        Index("idx_wlcoll_user_created", "user_id", "created_at"),
    )

    def __repr__(self):
        return f"<WatchlistCollection id={self.id} name={self.name!r}>"


class WatchlistItem(Base):
    """Single movie/tv entry inside a WatchlistCollection."""
    __tablename__ = "watchlist_items"

    id            = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    collection_id = Column(UUID(as_uuid=True), ForeignKey("watchlist_collections.id", ondelete="CASCADE"), nullable=False)
    movie_id      = Column(Integer, nullable=False)
    media_type    = Column(String(10), nullable=False, default='movie', server_default='movie')
    added_at      = Column(DateTime(timezone=True), nullable=False, default=utcnow)

    collection = relationship("WatchlistCollection", back_populates="items")
    movie      = relationship("Movie", backref="watchlist_collection_items")

    __table_args__ = (
        ForeignKeyConstraint(["movie_id", "media_type"], ["movies.id", "movies.type"], ondelete="CASCADE"),
        UniqueConstraint("collection_id", "movie_id", "media_type", name="uq_wlitem_coll_movie"),
        Index("idx_wlitem_collection_id", "collection_id"),
        Index("idx_wlitem_collection_added", "collection_id", "added_at"),
    )

    def __repr__(self):
        return f"<WatchlistItem collection={self.collection_id} movie={self.movie_id}>"


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


class ClickHistory(Base):
    """Tracks clicks on movie/TV items for behavioral analysis."""
    __tablename__ = "click_history"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    item_id = Column(Integer, nullable=False)
    media_type = Column(String(10), nullable=False, default="movie", server_default="movie")
    source = Column(String(30), nullable=True)
    clicked_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)

    user = relationship("User", back_populates="click_histories")

    __table_args__ = (
        Index("idx_click_history_user_id", "user_id"),
        Index("idx_click_history_user_clicked", "user_id", "clicked_at", postgresql_ops={"clicked_at": "DESC"}),
    )

    def __repr__(self):
        return f"<ClickHistory user={self.user_id} item={self.item_id} type={self.media_type}>"


class MovieRating(Base):
    """Imported ratings from moctale_scrapper for meter display."""
    __tablename__ = "movie_ratings"

    id = Column(Integer, primary_key=True)
    media_type = Column(String(10), primary_key=True, default='movie', server_default='movie')
    slug = Column(Text, nullable=False)
    title = Column(Text, nullable=True)
    year = Column(Integer, nullable=True)
    score = Column(Integer, nullable=True)
    total_votes = Column(Integer, nullable=True)
    perfection = Column(Float, nullable=True)
    go_for_it = Column(Float, nullable=True)
    timepass = Column(Float, nullable=True)
    skip = Column(Float, nullable=True)
    fetched_at = Column(DateTime(timezone=True), nullable=True)

    movie = relationship("Movie", backref="movie_rating", uselist=False)

    __table_args__ = (
        ForeignKeyConstraint(["id", "media_type"], ["movies.id", "movies.type"], ondelete="CASCADE"),
    )

    def __repr__(self):
        return f"<MovieRating id={self.id} score={self.score}>\n"


class TvRating(Base):
    """Imported TV ratings from moctale_scrapper for meter display."""
    __tablename__ = "tv_ratings"

    id = Column(Integer, primary_key=True)
    media_type = Column(String(10), primary_key=True, default='tv', server_default='tv')
    slug = Column(Text, nullable=False)
    title = Column(Text, nullable=True)
    year = Column(Integer, nullable=True)
    score = Column(Integer, nullable=True)
    total_votes = Column(Integer, nullable=True)
    perfection = Column(Float, nullable=True)
    go_for_it = Column(Float, nullable=True)
    timepass = Column(Float, nullable=True)
    skip = Column(Float, nullable=True)
    fetched_at = Column(DateTime(timezone=True), nullable=True)

    movie = relationship("Movie", backref="tv_rating", uselist=False)

    __table_args__ = (
        ForeignKeyConstraint(["id", "media_type"], ["movies.id", "movies.type"], ondelete="CASCADE"),
    )

    def __repr__(self):
        return f"<TvRating id={self.id} score={self.score}>\n"


class RatingNeeded(Base):
    """Table to record movies/shows that users want ratings for."""
    __tablename__ = "rating_needed"

    id = Column(Integer, primary_key=True)
    title = Column(Text, nullable=True)
    content = Column(Text, nullable=True)  # show/movie
    year = Column(Integer, nullable=True)
    fetched_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)

    def __repr__(self):
        return f"<RatingNeeded id={self.id} title={self.title} content={self.content}>"

class RequestedContent(Base):
    """Content requests from users who couldn't find what they searched for."""
    __tablename__ = "requested_content"

    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(String(500), nullable=False)
    content_type = Column(String(50), nullable=False)  # Movie / TV Show
    requested_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)

    def __repr__(self):
        return f"<RequestedContent id={self.id} title={self.title} type={self.content_type}>"


class WatchingTracker(Base):
    __tablename__ = "watching_tracker"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    tv_id = Column(Integer, nullable=False)

    next_episode_date = Column(Date, nullable=True)
    last_checked_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("idx_user_tv", "user_id", "tv_id", unique=True),
    )

    def __repr__(self):
        return f"<WatchingTracker user={self.user_id} tv={self.tv_id}>"

class TempTracker(Base):
    __tablename__ = "temp_tracker"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    tv_id = Column(Integer, nullable=False)
    added_at = Column(DateTime(timezone=True), default=utcnow)

    __table_args__ = (
        Index("idx_temp_tracker_user_tv", "user_id", "tv_id", unique=True),
    )

    def __repr__(self):
        return f"<TempTracker user={self.user_id} tv={self.tv_id}>"


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    tv_id = Column(Integer, nullable=False)
    message = Column(Text, nullable=False)
    seen = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    __table_args__ = (
        Index("idx_notif_user_id", "user_id"),
        Index("idx_notif_user_seen", "user_id", "seen"),
    )

    def __repr__(self):
        return f"<Notification user={self.user_id} tv={self.tv_id} seen={self.seen}>"


class Feedback(Base):
    """User feedback and bug reports."""
    __tablename__ = "feedback"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    category = Column(String(50), nullable=False)       # error, improvement, other
    content = Column(Text, nullable=False)
    image_url = Column(Text, nullable=True)             # Path to compressed local image
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)

    user = relationship("User", backref="feedbacks")

    def __repr__(self):
        return f"<Feedback id={self.id} category={self.category}>"


# ═══════════════════════════════════════════════════════════════
# PHASE 1: Advanced Recommendation Engine Tables
# ═══════════════════════════════════════════════════════════════

class ContentCatalog(Base):
    __tablename__ = "content_catalog"

    id             = Column(Integer, primary_key=True, autoincrement=True)
    tmdb_id        = Column(Integer, nullable=False)
    media_type     = Column(String(10), nullable=False)         # "movie" | "tv"

    # ── Categorical Feature Vectors ──────────────────────────────────────
    genre_ids      = Column(ARRAY(Integer), default=[])         # TMDB genre integer IDs
    keyword_ids    = Column(ARRAY(Integer), default=[])         # TMDB keyword IDs (top 15)
    studio_ids     = Column(ARRAY(Integer), default=[])         # Production company IDs

    # ── Talent Dimension ─────────────────────────────────────────────────
    cast_ids       = Column(ARRAY(Integer), default=[])         # Top 10 cast person IDs
    crew_ids       = Column(JSONB, default={})
    # crew_ids structure: {"director": [id], "writer": [id], "producer": [id]}

    # ── Demographic Metadata ─────────────────────────────────────────────
    original_language = Column(String(10))                      # e.g. "en", "ja", "hi"
    origin_countries  = Column(ARRAY(String(5)), default=[])    # e.g. ["US","IN","KR"]
    release_era       = Column(String(20))                      # e.g. "1990s", "2020s"
    release_year      = Column(Integer)

    # ── Performance Indices ───────────────────────────────────────────────
    vote_average   = Column(Float, default=0.0)
    vote_count     = Column(Integer, default=0)
    popularity     = Column(Float, default=0.0)

    # ── Metadata ─────────────────────────────────────────────────────────
    title          = Column(String(500))
    poster_path    = Column(String(500))
    is_seed        = Column(Boolean, default=False)  # True = part of 20K seed, False = on-demand
    ingested_at    = Column(DateTime(timezone=True), default=utcnow)

    __table_args__ = (
        UniqueConstraint("tmdb_id", "media_type", name="uq_catalog_tmdb_media"),
    )


class UserTasteProfile(Base):
    __tablename__ = "user_taste_profiles"

    id      = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)

    # ── Affinity Weight Vectors (JSONB float maps) ────────────────────────
    genre_weights    = Column(JSONB, default={})
    # e.g. {"28": 42.5, "878": 18.2, "27": -25.0}  (TMDB genre IDs as string keys)

    cast_weights     = Column(JSONB, default={})
    # e.g. {"500": 15.4, "1136406": 8.2}            (TMDB person IDs as string keys)

    crew_weights     = Column(JSONB, default={})
    # e.g. {"525": 20.0}                             (director/writer person IDs)

    keyword_weights  = Column(JSONB, default={})
    # e.g. {"9715": 12.0, "180547": -8.0}           (TMDB keyword IDs)

    language_weights = Column(JSONB, default={})
    # e.g. {"en": 1.2, "ja": 0.9, "ko": 1.5}       (float multipliers, neutral = 1.0)

    era_weights      = Column(JSONB, default={})
    # e.g. {"1990s": -5.0, "2010s": 22.0, "2020s": 35.0}

    negative_weights = Column(JSONB, default={})
    # Stores negative signals (Phase 9.2)

    # ── Global Interaction Statistics ─────────────────────────────────────
    total_interactions = Column(Integer, default=0)
    avg_rating_given   = Column(Float, default=0.0)
    last_updated       = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    user = relationship("User", backref="taste_profile", uselist=False)


# ═══════════════════════════════════════════════════════════════
# PHASE 6: Feedback Loop — Interaction Log Table
# ═══════════════════════════════════════════════════════════════

class InteractionLog(Base):
    """
    Records every recommendation feedback signal per user.

    Signals:
        thumbs_up   → label  3, delta +10.0 (genres/cast/crew/era)
        click       → label  2, delta  +2.0 (genres only, time-decayed)
        ignore      → label  0, delta  -0.5 (genres only, time-decayed)
        thumbs_down → label -1, delta -15.0 (genres/cast/crew/era)

    feature_snapshot stores the 16-dim feature vector from Phase 4 at the
    time the item was shown — used as training data for nightly XGBRanker retrain.
    """
    __tablename__ = "interaction_log"

    id          = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id     = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    tmdb_id     = Column(Integer, nullable=False)
    media_type  = Column(String(10), nullable=False)  # "movie" | "tv"
    signal_type = Column(String(20), nullable=False)   # "thumbs_up" | "thumbs_down" | "click" | "ignore"
    label       = Column(Integer, nullable=False)       # -1 | 0 | 2 | 3

    # Pre-computed feature vector at the time of interaction (for training)
    feature_snapshot = Column(JSONB, default={})
    # Keys match Phase 4 FEATURE_COLUMNS:
    # ppr_score, ppr_rank_norm, vote_average, vote_count_log, popularity_log,
    # recency_score, user_genre_score, user_cast_score, user_crew_score,
    # user_keyword_score, user_era_score, user_language_mult,
    # genre_overlap_count, cast_overlap_count, same_language, same_era

    timestamp = Column(DateTime(timezone=True), nullable=False, default=utcnow)

    user = relationship("User", backref="interaction_logs")

    __table_args__ = (
        Index("idx_interaction_log_user_id", "user_id"),
        Index("idx_interaction_log_user_ts", "user_id", "timestamp"),
        Index("idx_interaction_log_signal", "signal_type"),
    )

    def __repr__(self):
        return f"<InteractionLog user={self.user_id} tmdb={self.tmdb_id} signal={self.signal_type}>"
