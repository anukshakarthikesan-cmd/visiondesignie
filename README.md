# VisionDesignie

VisionDesignie is a full-stack AI architecture assistant:

- Frontend: React + Vite
- Backend: FastAPI
- Database/Auth: Supabase
- LLM: Groq (via backend only)
- Retrieval: FAISS vector index
- Visualization: 2D UI + React Three Fiber 3D

## Repository structure

- `frontend/` - Vite React client
- `backend/` - FastAPI API and RAG pipeline
- `backend/data/vector_store/` - FAISS index files used by backend
- `supabase/migrations/` - SQL migrations
- `render.yaml` - Render service config
- `DEPLOYMENT_GUIDE.md` - detailed deployment steps

## Prerequisites

- Python 3.12+ (project also supports 3.11+)
- Node.js 20+
- npm
- Supabase project
- Groq API key

## Local development

### 1) Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Backend URLs:

- Health: `http://127.0.0.1:8000/health`
- Docs: `http://127.0.0.1:8000/docs`

### 2) Frontend

```bash
cd frontend
copy .env.example .env.local
npm install
npm run dev
```

Frontend URL:

- `http://localhost:5173`

## Environment variables

### Backend (`backend/.env`)

Required:

- `GROQ_API_KEY`

Common production:

- `ENVIRONMENT=production`
- `ENABLE_OPENAPI_DOCS=true` (set true if you want `/docs` in production)
- `CORS_ORIGINS=https://<your-vercel-domain>`
- `CORS_ALLOW_ORIGIN_REGEX=https://.*\.vercel\.app` (optional for preview deploys)
- `CHAT_RATE_LIMIT=60/minute` (or `disabled`)

Optional Supabase server-side metrics/history seeding:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

### Frontend (Vercel env vars or local `.env.local`)

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_CHAT_API_BASE` (Render backend URL, no trailing slash)

Templates:

- `frontend/.env.example`
- `frontend/.env.production.example`

## Tests

Backend:

```bash
cd backend
venv\Scripts\activate
python -m unittest discover -s tests -p "test_*.py" -v
```

Frontend:

```bash
cd frontend
npm run lint
npm test
npm run build
```

## Deployment (Vercel + Render)

This project is configured for:

- Frontend on Vercel
- Backend on Render
- Supabase cloud

Use:

1. `render.yaml` for backend service defaults
2. `frontend/vercel.json` for SPA route fallback
3. `DEPLOYMENT_GUIDE.md` for full click-by-click deployment

## FAISS and dataset notes

- Runtime retrieval uses:
  - `backend/data/vector_store/index.faiss`
  - `backend/data/vector_store/index.pkl`
- Raw source documents folder is intentionally excluded from repo for size:
  - `backend/data/documents/`

If you retrain/rebuild embeddings in future, keep a private backup of raw source docs.

## Security notes

- Never commit real `.env` files.
- Never expose Groq key or Supabase service role key in frontend.
- Frontend should use Supabase anon key only.
