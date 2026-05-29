# Movientum Deployment Guide

This document outlines the complete procedure to deploy the Movientum monorepo online.

**Architecture Overview:**
- **Codebase:** GitHub (Monorepo)
- **Frontend:** Vercel (React + Vite)
- **Backend:** Azure App Service (FastAPI + Python)
- **Database:** Supabase (PostgreSQL)
- **Cache:** Upstash (Serverless Redis)

---

## 1. Push Code to GitHub

First, upload your code to a new GitHub repository.

1. Go to [GitHub](https://github.com/) and create a new repository (e.g., `movientum`).
2. Open your terminal in the root of your project:
   ```bash
   git init
   git add .
   git commit -m "Initial commit for deployment"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/movientum.git
   git push -u origin main
   ```

---

## 2. Deploy Backend to Azure App Service

We deploy the backend first so we can get its URL and provide it to the frontend.

### Step 2.1: Create the Web App
1. Log into the [Azure Portal](https://portal.azure.com/).
2. Search for **App Services** and click **Create -> Web App**.
3. **Basics Tab:**
   - **Resource Group:** Create new (e.g., `movientum-rg`)
   - **Name:** Choose a unique name (e.g., `movientum-api`). Your URL will be `https://movientum-api.azurewebsites.net`.
   - **Publish:** Code
   - **Runtime stack:** Python 3.10 (or 3.11)
   - **Operating System:** Linux
   - **Region:** Choose the one closest to your Supabase/Upstash regions.
   - **Pricing plan:** Choose Basic (B1) or Free (F1) if available.
4. Click **Review + create** and then **Create**.

### Step 2.2: Configure Environment Variables
1. Once deployed, go to the resource.
2. In the left sidebar, under **Settings**, select **Environment variables** (or **Configuration**).
3. Add the following **App settings** (copy values from your local `backend/.env`):
   - `DATABASE_URL` (Your Supabase PostgreSQL connection string)
   - `SUPABASE_URL`
   - `SUPABASE_KEY`
   - `JWT_SECRET`
   - `TMDB_API_KEY`
   - `TMDB_ACCESS_TOKEN`
   - `REDIS_URL` (Your Upstash Redis URL, e.g., `rediss://...`)
   - `CORS_ORIGINS` (Set this to `*` for now; later update it to your Vercel URL, e.g., `https://movientum.vercel.app`)

### Step 2.3: Set Startup Command
1. In the same Configuration/Settings pane, go to **General settings**.
2. Find the **Startup Command** field and enter:
   ```bash
   cd backend && gunicorn app.main:app --workers 4 --worker-class uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000
   ```
   *(Note: Adjust `app.main:app` if your FastAPI instance is named differently, e.g., `main:app`)*

### Step 2.4: Connect GitHub (Continuous Deployment)
1. In the left sidebar, under **Deployment**, select **Deployment Center**.
2. **Source:** GitHub.
3. Authorize Azure and select your `movientum` repository and `main` branch.
4. Azure will generate a GitHub Actions workflow file in your repo (e.g., `.github/workflows/main_movientum-api.yml`). 
5. **IMPORTANT (Monorepo Fix):** Pull the workflow file locally (`git pull`), open it, and ensure the `working-directory` is set to `backend` for the pip install and build steps. Push the changes.

Wait for the GitHub Action to finish. Visit `https://movientum-api.azurewebsites.net/docs` to verify it's working.

---

## 3. Deploy Frontend to Vercel

### Step 3.1: Import Project
1. Log into [Vercel](https://vercel.com/) and click **Add New... -> Project**.
2. Connect your GitHub account and Import the `movientum` repository.

### Step 3.2: Configure Monorepo Settings
1. In the "Configure Project" screen, look for **Root Directory**.
2. Click **Edit** and select the `frontend` folder.
3. **Build and Output Settings** (Vercel usually detects Vite automatically, but verify):
   - Build Command: `npm run build`
   - Output Directory: `dist`
   - Install Command: `npm install`

### Step 3.3: Environment Variables
1. Expand the **Environment Variables** section.
2. Add your frontend variables (from `frontend/.env`):
   - `VITE_API_BASE_URL`: Set this to your new Azure backend URL (e.g., `https://movientum-api.azurewebsites.net/api/v1`)
   - `VITE_TMDB_API_KEY`: Your TMDB key
   - `VITE_TMDB_ACCESS_TOKEN`: Your TMDB token
   - `VITE_SUPABASE_URL`: Your Supabase URL
   - `VITE_SUPABASE_KEY`: Your Supabase Anon Key
3. Click **Deploy**.

---

## 4. Final Verification
1. Once Vercel finishes deploying, copy your frontend URL (e.g., `https://movientum.vercel.app`).
2. Go back to your Azure Backend -> Environment Variables.
3. Update `CORS_ORIGINS` to include your Vercel URL (e.g., `https://movientum.vercel.app`). Save and restart the Azure App Service.
4. Visit your Vercel URL. The app should load, communicate with the Azure backend, and fetch TMDB/Supabase data seamlessly.
