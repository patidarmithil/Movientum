import asyncio
from app.db.database import AsyncSessionLocal
from app.db.orm_models import Movie
from sqlalchemy import select

async def run():
    async with AsyncSessionLocal() as db:
        from sqlalchemy import func
        from app.db.orm_models import Genre, MovieGenre
        movie_count = (await db.execute(select(func.count(Movie.id)))).scalar_one()
        genre_count = (await db.execute(select(func.count(Genre.id)))).scalar_one()
        mg_count = (await db.execute(select(func.count(MovieGenre.movie_id)))).scalar_one()
        print(f"Total Movies: {movie_count}")
        print(f"Total Genres: {genre_count}")
        print(f"Total MovieGenre relations: {mg_count}")
        
        res = await db.execute(select(Genre))
        genres = res.scalars().all()
        for g in genres:
            cnt = (await db.execute(select(func.count(MovieGenre.movie_id)).where(MovieGenre.genre_id == g.id))).scalar_one()
            print(f"Genre: ID={g.id} Name={g.name} | Movies={cnt}")

if __name__ == "__main__":
    asyncio.run(run())
