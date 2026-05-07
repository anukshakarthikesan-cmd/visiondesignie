# Visiondesignie Deployment Guide (Vercel + Render + Supabase)

Follow these steps in order.

## STEP 1 -> GitHub setup

1. Open terminal at `rag-chatbot`.
2. Install Git LFS once on your machine (required for FAISS files):
   - `git lfs install`
3. Initialize git if needed:
   - `git init`
   - `git add .`
   - `git commit -m "prepare deployment setup"`
4. Create a GitHub repo (for example `visiondesignie`).
5. Connect local repo and push:
   - `git remote add origin https://github.com/<your-username>/visiondesignie.git`
   - `git branch -M main`
   - `git push -u origin main`

Notes:
- If `remote origin already exists`, use:
  - `git remote set-url origin https://github.com/<your-username>/visiondesignie.git`
- If `git` is not recognized on Windows, install Git and reopen terminal.

## STEP 2 -> Backend deployment (Render)

1. Login to [Render](https://render.com/).
2. Click **New +** -> **Web Service**.
3. Connect your GitHub repo and select `visiondesignie`.
4. Use these exact settings:
   - **Environment**: `Python`
   - **Root Directory**: `backend`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
5. Add Environment Variables in Render:
   - `ENVIRONMENT=production`
   - `ENABLE_OPENAPI_DOCS=true`
   - `GROQ_API_KEY=<your-groq-key>`
   - `CHAT_RATE_LIMIT=60/minute`
   - `CORS_ORIGINS=https://<your-vercel-app>.vercel.app`
   - Optional preview support:
     - `CORS_ALLOW_ORIGIN_REGEX=https://.*\.vercel\.app`
   - If using Supabase metrics/history seeding:
     - `SUPABASE_URL=https://<project>.supabase.co`
     - `SUPABASE_SERVICE_ROLE_KEY=<service-role-key>`
6. Click **Create Web Service**.

Notes:
- This repo includes `render.yaml` with matching defaults.
- Make sure `backend/data/vector_store/index.faiss` and `index.pkl` are committed to GitHub (LFS upload succeeds).

## STEP 3 -> Backend testing

After Render deploy completes:

1. Open your backend URL:
   - `https://<your-render-service>.onrender.com/health`
2. Expected: JSON with status keys.
3. Open docs:
   - `https://<your-render-service>.onrender.com/docs`
4. Test chat endpoint quickly:
   - Use docs UI (`/docs`) -> `POST /chat`.
   - Send:
     ```json
     {
       "message": "Hi",
       "chat_id": "deploy-smoke-test"
     }
     ```

## STEP 4 -> Frontend deployment (Vercel)

1. Login to [Vercel](https://vercel.com/).
2. Click **Add New...** -> **Project**.
3. Import the same GitHub repo.
4. Set:
   - **Root Directory**: `frontend`
   - Framework should auto-detect Vite.
5. Add Vercel Environment Variables:
   - `VITE_SUPABASE_URL=https://<project>.supabase.co`
   - `VITE_SUPABASE_ANON_KEY=<anon-key>`
   - `VITE_CHAT_API_BASE=https://<your-render-service>.onrender.com`
6. Click **Deploy**.

Notes:
- `frontend/vercel.json` already adds SPA rewrite to `index.html`.
- Use `frontend/.env.example` and `frontend/.env.production.example` as variable references.

## STEP 5 -> Frontend-backend connection

1. Copy your final Vercel domain, for example:
   - `https://visiondesignie.vercel.app`
2. Go to Render -> backend service -> Environment.
3. Update backend CORS:
   - `CORS_ORIGINS=https://visiondesignie.vercel.app`
4. Keep preview support if needed:
   - `CORS_ALLOW_ORIGIN_REGEX=https://.*\.vercel\.app`
5. Save and redeploy Render service.

## STEP 6 -> Final production testing

Run this checklist:

1. Open frontend URL on Vercel.
2. Login/signup flow works with Supabase.
3. Send a chat message:
   - Response streams and renders in UI.
4. Backend endpoints:
   - `/health` returns OK
   - `/docs` opens
5. 2D rendering works in chat/design panel.
6. 3D page loads with R3F.
7. Check browser console for CORS/network errors.
8. Check Render logs for backend exceptions.

## Common issues and fixes

1. **CORS blocked**
   - Fix `CORS_ORIGINS` to exact frontend URL.
   - For preview builds, set `CORS_ALLOW_ORIGIN_REGEX=https://.*\.vercel\.app`.

2. **`/chat` 500 due to missing secrets**
   - Verify `GROQ_API_KEY` is set on Render.
   - If metrics enabled, verify Supabase service role key.

3. **FAISS load error (`Vector store not found`)**
   - Ensure `backend/data/vector_store/index.faiss` and `index.pkl` are in GitHub.
   - Ensure Git LFS objects were uploaded successfully during push.
   - Redeploy after pushing those files.

4. **Frontend cannot call backend**
   - Ensure `VITE_CHAT_API_BASE` is Render HTTPS URL (no trailing slash).
   - Redeploy frontend after changing env vars.

5. **Build fails on Vercel**
   - Confirm Root Directory is `frontend`.
   - Check that `package-lock.json` exists in `frontend`.

6. **Render sleeping on free plan**
   - First request after idle may be slow; this is expected on free tier.
