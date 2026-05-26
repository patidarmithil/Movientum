import sys
import os
from dotenv import load_dotenv

sys.path.insert(0, r"c:\Users\USER\Desktop\BTP_baseline\FedPCL code\backend")

# Import the actual settings singleton from the app
from app.config import settings

print("DB Password in settings:", repr(settings.db_password))
print("Database URL in settings:", repr(settings.database_url))
print("Async Database URL in settings:", repr(settings.async_database_url))
print("Safe Async DB URL in settings:", repr(settings.safe_async_db_url))
