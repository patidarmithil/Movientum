import pandas as pd
import sqlalchemy
from sqlalchemy import text
import os
from dotenv import load_dotenv

# Load env from backend/.env
load_dotenv('../.env')
db_url = os.getenv('DATABASE_URL')

if not db_url:
    print("Error: DATABASE_URL not found in environment!")
    exit(1)

# File paths
movie_rating_csv = r'c:\Users\USER\Desktop\BTP_baseline\FedPCL code\moctale_scrapper\movie_rating.csv'
movie_rating_21_25_csv = r'c:\Users\USER\Desktop\BTP_baseline\FedPCL code\moctale_scrapper\movie_rating_21_to_25.csv'

print("Loading CSV files...")
df1 = pd.read_csv(movie_rating_csv)
df2 = pd.read_csv(movie_rating_21_25_csv)

print(f"Loaded {len(df1)} rows from movie_rating.csv")
print(f"Loaded {len(df2)} rows from movie_rating_21_to_25.csv")

# Combine datasets
combined_df = pd.concat([df1, df2], ignore_index=True)

# Clean up duplicates by id (keeping the last/newest fetch details)
combined_df.drop_duplicates(subset=["id"], keep="last", inplace=True)
print(f"Deduplicated to {len(combined_df)} unique rows.")

# Ensure title and year columns exist
if 'title' not in combined_df.columns:
    combined_df['title'] = ''
if 'year' not in combined_df.columns:
    combined_df['year'] = 0

# Convert types to avoid matching errors
combined_df['id'] = combined_df['id'].astype(int)
combined_df['year'] = combined_df['year'].fillna(0).astype(int)

# Create connection engine
engine = sqlalchemy.create_engine(db_url)

with engine.connect() as conn:
    print("1. Dropping old moctale_ratings table...")
    conn.execute(text("DROP TABLE IF EXISTS moctale_ratings CASCADE;"))
    
    print("2. Creating movie_ratings table...")
    conn.execute(text("""
    DROP TABLE IF EXISTS movie_ratings CASCADE;
    CREATE TABLE movie_ratings (
        id INT PRIMARY KEY,
        slug TEXT NOT NULL,
        title TEXT,
        year INT,
        score INT,
        total_votes INT,
        perfection FLOAT,
        go_for_it FLOAT,
        timepass FLOAT,
        skip FLOAT,
        fetched_at TIMESTAMP
    );
    """))

    print("3. Creating tv_ratings table...")
    conn.execute(text("""
    DROP TABLE IF EXISTS tv_ratings CASCADE;
    CREATE TABLE tv_ratings (
        id INT PRIMARY KEY,
        slug TEXT NOT NULL,
        title TEXT,
        year INT,
        score INT,
        total_votes INT,
        perfection FLOAT,
        go_for_it FLOAT,
        timepass FLOAT,
        skip FLOAT,
        fetched_at TIMESTAMP
    );
    """))
    conn.commit()

# Write data using pandas
print("4. Writing data into movie_ratings table...")
# Only keep columns that match the target table
target_cols = [
    "id", "slug", "title", "year", "score", "total_votes", 
    "perfection", "go_for_it", "timepass", "skip", "fetched_at"
]
df_to_insert = combined_df[target_cols]
df_to_insert.to_sql('movie_ratings', engine, if_exists='append', index=False)

with engine.connect() as conn:
    print("5. Syncing title and release year from movies catalog...")
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

print("Migration and load complete!")
