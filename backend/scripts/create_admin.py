import asyncio
import sys
import os

# Ensure app is in path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app.db.database import AsyncSessionLocal
from app.db.orm_models import User
from app.utils.password_utils import hash_password
from sqlalchemy.future import select

async def create_admin():
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.email == "admin@movientum.vercel.app"))
        user = result.scalars().first()

        if user:
            print("Admin user already exists. Updating role to 'admin'.")
            user.role = "admin"
            user.password_hash = hash_password("movientum@123")
        else:
            print("Creating new admin user...")
            user = User(
                username="admin",
                email="admin@movientum.vercel.app",
                password_hash=hash_password("movientum@123"),
                role="admin",
                is_active=True
            )
            db.add(user)

        await db.commit()
        print("Admin user created/updated successfully.")

if __name__ == "__main__":
    asyncio.run(create_admin())
