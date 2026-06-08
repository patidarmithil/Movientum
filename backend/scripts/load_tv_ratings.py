import pandas as pd
import sqlalchemy
from sqlalchemy import text
import os
import re
from pathlib import Path
from dotenv import load_dotenv

# Load env file relative to script path
script_dir = Path(__file__).parent
dotenv_path = script_dir.parent / '.env'
load_dotenv(dotenv_path)

db_url = os.getenv('DATABASE_URL')
if not db_url:
    print("Error: DATABASE_URL not found in environment!")
    exit(1)

# File paths
tv_rating_csv = r'c:\Users\USER\Desktop\BTP_baseline\FedPCL code\moctale_scrapper\tv\tv_rating.csv'

if not os.path.exists(tv_rating_csv):
    print(f"Error: TV ratings CSV not found at {tv_rating_csv}")
    exit(1)

print("Loading CSV file...")
df = pd.read_csv(tv_rating_csv)
print(f"Loaded {len(df)} rows from tv_rating.csv")

# Clean up duplicates by id
df.drop_duplicates(subset=["id"], keep="last", inplace=True)
print(f"Deduplicated to {len(df)} unique rows.")

def parse_slug(slug):
    # Extract year from the end (e.g. game-of-thrones-2011 -> Game Of Thrones, 2011)
    match = re.search(r'^(.*)-(\d{4})$', slug)
    if match:
        name_part, year = match.groups()
        title = ' '.join(word.capitalize() for word in name_part.split('-'))
        return title, int(year)
    else:
        title = ' '.join(word.capitalize() for word in slug.split('-'))
        return title, None

# Parse title and year
df['title'] = df['slug'].apply(lambda s: parse_slug(s)[0])
df['year'] = df['slug'].apply(lambda s: parse_slug(s)[1] or 0)

# Convert types
df['id'] = df['id'].astype(int)
df['year'] = df['year'].fillna(0).astype(int)

# Create engine
engine = sqlalchemy.create_engine(db_url)

with engine.connect() as conn:
    print("1. Checking existing TV shows / movies in catalog...")
    # Fetch all existing movie/tv IDs
    result = conn.execute(text("SELECT id FROM movies;"))
    existing_ids = {row[0] for row in result.fetchall()}
    print(f"Found {len(existing_ids)} existing entries in movies table.")

    # Find IDs in CSV that are not in movies table
    csv_ids = set(df['id'])
    missing_ids = csv_ids - existing_ids
    print(f"Found {len(missing_ids)} missing titles that need database stubs.")

    if missing_ids:
        print("2. Inserting stubs for missing titles in movies table...")
        stubs_inserted = 0
        for idx, row in df[df['id'].isin(missing_ids)].iterrows():
            title = row['title']
            year = row['year']
            release_date = f"{year}-01-01" if year > 0 else None
            # We approximate TMDB popularity/vote_count using total_votes
            popularity = float(row['total_votes'])
            vote_average = float(row['score']) / 10.0 if row['score'] > 0 else 0.0
            vote_count = int(row['total_votes'])

            conn.execute(
                text("""
                INSERT INTO movies (id, title, original_title, overview, release_date, type, popularity, vote_average, vote_count, fetched_at)
                VALUES (:id, :title, :original_title, :overview, CAST(:release_date AS DATE), 'tv', :popularity, :vote_average, :vote_count, NOW())
                ON CONFLICT (id) DO NOTHING;
                """),
                {
                    "id": int(row['id']),
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
        conn.commit()
        print(f"Successfully inserted {stubs_inserted} stubs into movies table.")
    else:
        print("All IDs are already present in the movies table. Skipping stub insertion.")

    print("3. Truncating tv_ratings table...")
    conn.execute(text("TRUNCATE TABLE tv_ratings RESTART IDENTITY CASCADE;"))
    conn.commit()

# Write TV rating data to tv_ratings table
print("4. Writing TV rating data to tv_ratings table...")
target_cols = [
    "id", "slug", "title", "year", "score", "total_votes", 
    "perfection", "go_for_it", "timepass", "skip", "fetched_at"
]
df_to_insert = df[target_cols]
df_to_insert.to_sql('tv_ratings', engine, if_exists='append', index=False)

with engine.connect() as conn:
    print("5. Syncing actual title and release year from movies catalog...")
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

print("TV Ratings database import complete!")
