FROM python:3.11-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1

# ✅ Step 1: copy only requirements first
COPY requirements.txt .

# ✅ Step 2: install dependencies (this layer gets cached)
RUN pip install --no-cache-dir -r requirements.txt

# ✅ Step 3: copy rest of code
COPY . .

EXPOSE 8000

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
