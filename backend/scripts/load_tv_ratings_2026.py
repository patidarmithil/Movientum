import pandas as pd
import sqlalchemy
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert as pg_insert
import os
import re
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
csv_path = r'c:\Users\USER\Desktop\BTP_baseline\FedPCL code\moctale_scrapper\show\show_rating_2026.csv'

if not os.path.exists(csv_path):
    print(f"Error: CSV not found at {csv_path}")
    exit(1)

print("Loading CSV file...")
df = pd.read_csv(csv_path)
print(f"Loaded {len(df)} rows from show_rating_2026.csv")

# Clean up duplicates by id
df.drop_duplicates(subset=["id"], keep="last", inplace=True)
print(f"Deduplicated CSV to {len(df)} unique rows.")

def parse_slug(slug):
    match = re.search(r'^(.*)-(\d{4})$', slug)
    if match:
        name_part, year = match.groups()
        title = ' '.join(word.capitalize() for word in name_part.split('-'))
        return title, int(year)
    else:
        title = ' '.join(word.capitalize() for word in slug.split('-'))
        return title, None

# Parse titles and years in df
df['title_parsed'] = df['slug'].apply(lambda s: parse_slug(s)[0])
df['year_parsed'] = df['slug'].apply(lambda s: parse_slug(s)[1] or 0)

# Create connection engine
engine = sqlalchemy.create_engine(db_url)
metadata = sqlalchemy.MetaData()

# Define tv_ratings table structure for pg_insert
tv_ratings = sqlalchemy.Table(
    'tv_ratings', metadata,
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

with engine.connect() as conn:
    # 1. Check existing entries in movies catalog to insert stubs if needed
    print("Checking catalog for existing shows to insert stubs...")
    result = conn.execute(text("SELECT id FROM movies;"))
    existing_ids = {row[0] for row in result.fetchall()}
    
    stubs_inserted = 0
    for idx, row in df.iterrows():
        show_id = int(row["id"])
        if show_id not in existing_ids:
            title = row["title_parsed"]
            year = int(row["year_parsed"])
            release_date = f"{year}-01-01" if year > 0 else None
            
            popularity = float(row['total_votes']) if not pd.isna(row['total_votes']) else 0.0
            vote_average = float(row['score']) / 10.0 if not pd.isna(row['score']) and row['score'] > 0 else 0.0
            vote_count = int(row['total_votes']) if not pd.isna(row['total_votes']) else 0

            conn.execute(
                text("""
                INSERT INTO movies (id, title, original_title, overview, release_date, type, popularity, vote_average, vote_count, fetched_at)
                VALUES (:id, :title, :original_title, :overview, CAST(:release_date AS DATE), 'tv', :popularity, :vote_average, :vote_count, NOW())
                ON CONFLICT (id) DO NOTHING;
                """),
                {
                    "id": show_id,
                    "title": title,
                    "original_title": title,
                    "overview": f"Stub imported from Moctale rating list for TV Show '{title}'.",
                    "release_date": release_date,
                    "popularity": popularity,
                    "vote_average": vote_average,
                    "vote_count": vote_count
                }
            )
            stubs_inserted += 1
            existing_ids.add(show_id) # Avoid duplicate stub check/insert
            
    conn.commit()
    print(f"Inserted {stubs_inserted} stubs in movies table.")

    # 2. Perform upsert into tv_ratings
    print("Performing upsert into tv_ratings...")
    upsert_count = 0
    for idx, row in df.iterrows():
        val = {
            "id": int(row["id"]),
            "slug": str(row["slug"]),
            "title": row["title_parsed"],
            "year": int(row["year_parsed"]),
            "score": int(row["score"]) if not pd.isna(row["score"]) else None,
            "total_votes": int(row["total_votes"]) if not pd.isna(row["total_votes"]) else None,
            "perfection": float(row["perfection"]) if not pd.isna(row["perfection"]) else None,
            "go_for_it": float(row["go_for_it"]) if not pd.isna(row["go_for_it"]) else None,
            "timepass": float(row["timepass"]) if not pd.isna(row["timepass"]) else None,
            "skip": float(row["skip"]) if not pd.isna(row["skip"]) else None,
            "fetched_at": now
        }
        
        stmt = pg_insert(tv_ratings).values(val)
        stmt = stmt.on_conflict_do_update(
            index_elements=['id'],
            set_={
                'slug': stmt.excluded.slug,
                'title': stmt.excluded.title,
                'year': stmt.excluded.year,
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
    print(f"Successfully upserted {upsert_count} rows into tv_ratings.")

    # 3. Sync actual title and release year from movies catalog
    print("Syncing actual title and release year from movies catalog...")
    try:
        conn.execute(text("""
        UPDATE tv_ratings tr
        SET title = m.title,
            year = EXTRACT(YEAR FROM CAST(m.release_date AS DATE))
        FROM movies m
        WHERE tr.id = m.id;
        """))
        conn.commit()
        print("Updated title and year from movies table.")
    except Exception as e:
        print("Could not update title/year from movies:", e)
        conn.rollback()

print("TV Ratings database load complete!")
