import pandas as pd
import sqlalchemy
from sqlalchemy import text
import os
from dotenv import load_dotenv

# Load env
load_dotenv('../.env')
db_url = os.getenv('DATABASE_URL')

# Read CSV
csv_path = r'c:\Users\USER\Desktop\BTP_baseline\FedPCL code\moctale_scrapper\movie_rating.csv'
df = pd.read_csv(csv_path)

# Ensure title and year columns exist in dataframe to match schema, even if empty
df['title'] = ''
df['year'] = 0

engine = sqlalchemy.create_engine(db_url)

with engine.connect() as conn:
    # Create table
    conn.execute(text("""
    DROP TABLE IF EXISTS moctale_ratings;
    CREATE TABLE moctale_ratings (
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
    print("Table moctale_ratings created successfully.")

# We will let pandas write to it (append). 
# We'll use the df columns which match the table
df.to_sql('moctale_ratings', engine, if_exists='append', index=False)

with engine.connect() as conn:
    # Update title and year from movies table if it exists
    try:
        conn.execute(text("""
        UPDATE moctale_ratings mr
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

print(f"Imported {len(df)} rows into moctale_ratings.")
