import pandas as pd
import sqlalchemy
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert as pg_insert
import os
from datetime import datetime, timezone
from pathlib import Path
from dotenv import load_dotenv

# Load env relative to script path
script_dir = Path(__file__).parent
dotenv_path = script_dir.parent / '.env'
load_dotenv(dotenv_path)

db_url = os.getenv('DATABASE_URL')
if not db_url:
    print("Error: DATABASE_URL not found in environment!")
    exit(1)

# File paths
csv_path = r'c:\Users\USER\Desktop\BTP_baseline\FedPCL code\moctale_scrapper\movie\movie_rating_2026.csv'

if not os.path.exists(csv_path):
    print(f"Error: CSV not found at {csv_path}")
    exit(1)

print("Loading CSV file...")
df = pd.read_csv(csv_path)
print(f"Loaded {len(df)} rows from movie_rating_2026.csv")

# Clean up duplicates in CSV by id
df.drop_duplicates(subset=["id"], keep="last", inplace=True)
print(f"Deduplicated CSV to {len(df)} unique rows.")

# Convert types
df['id'] = df['id'].astype(int)

# Create connection engine
engine = sqlalchemy.create_engine(db_url)
metadata = sqlalchemy.MetaData()

# Define target movie_ratings table structure
movie_ratings = sqlalchemy.Table(
    'movie_ratings', metadata,
    sqlalchemy.Column('id', sqlalchemy.Integer, primary_key=True),
    sqlalchemy.Column('slug', sqlalchemy.String, nullable=False),
    sqlalchemy.Column('title', sqlalchemy.String),
    sqlalchemy.Column('year', sqlalchemy.Integer),
    sqlalchemy.Column('score', sqlalchemy.Integer),
    sqlalchemy.Column('total_votes', sqlalchemy.Integer),
    sqlalchemy.Column('perfection', sqlalchemy.Float),
    sqlalchemy.Column('go_for_it', sqlalchemy.Float),
    sqlalchemy.Column('timepass', sqlalchemy.Float),
    sqlalchemy.Column('skip', sqlalchemy.Float),
    sqlalchemy.Column('fetched_at', sqlalchemy.DateTime)
)

now = datetime.now(timezone.utc)

upsert_count = 0
with engine.connect() as conn:
    print("Performing upsert into movie_ratings...")
    for idx, row in df.iterrows():
        # Build values dict
        val = {
            "id": int(row["id"]),
            "slug": str(row["slug"]),
            "title": "",
            "year": 0,
            "score": int(row["score"]) if not pd.isna(row["score"]) else None,
            "total_votes": int(row["total_votes"]) if not pd.isna(row["total_votes"]) else None,
            "perfection": float(row["perfection"]) if not pd.isna(row["perfection"]) else None,
            "go_for_it": float(row["go_for_it"]) if not pd.isna(row["go_for_it"]) else None,
            "timepass": float(row["timepass"]) if not pd.isna(row["timepass"]) else None,
            "skip": float(row["skip"]) if not pd.isna(row["skip"]) else None,
            "fetched_at": now
        }
        
        # pg_insert
        stmt = pg_insert(movie_ratings).values(val)
        stmt = stmt.on_conflict_do_update(
            index_elements=['id'],
            set_={
                'slug': stmt.excluded.slug,
                'score': stmt.excluded.score,
                'total_votes': stmt.excluded.total_votes,
                'perfection': stmt.excluded.perfection,
                'go_for_it': stmt.excluded.go_for_it,
                'timepass': stmt.excluded.timepass,
                'skip': stmt.excluded.skip,
                'fetched_at': stmt.excluded.fetched_at
            }
        )
        conn.execute(stmt)
        upsert_count += 1
    
    conn.commit()
    print(f"Successfully upserted {upsert_count} rows.")

    print("Syncing title and release year from movies catalog...")
    try:
        conn.execute(text("""
        UPDATE movie_ratings mr
        SET title = m.title,
            year = EXTRACT(YEAR FROM CAST(m.release_date AS DATE))
        FROM movies m
        WHERE mr.id = m.id;
        """))
        conn.commit()
        print("Updated title and year from movies table.")
    except Exception as e:
        print("Could not update title/year from movies:", e)
        conn.rollback()

print("Upsert and sync complete!")
