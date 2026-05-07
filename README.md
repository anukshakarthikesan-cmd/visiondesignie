# VisionDesignie (rag-chatbot)

Monorepo: **FastAPI** RAG backend, **Vite + React** frontend, **Supabase** migrations.

## Prerequisites

- Python 3.11+ (3.13 recommended per backend)
- Node 20+ (for Vite)
- Supabase project (auth + Postgres)

## Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate   # Windows
# source .venv/bin/activate  # macOS/Linux
pip install -r requirements.txt
copy .env.example .env   # then set GROQ_API_KEY and optional vars
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

- **OpenAPI:** `/docs` and `/redoc` are served in development only. Set **`ENVIRONMENT=production`** (or **`APP_ENV=production`**) on the server to disable them.
- **Health:** `GET /health` — reports whether Groq, optional Supabase metrics env, and vector index directory are present (no secret values).
- **Rate limits:** `POST /chat` is limited per client IP (default **`60/minute`**; set **`CHAT_RATE_LIMIT=disabled`** to turn off, or e.g. `120/minute`).
- **Server chat memory:** When **`SUPABASE_URL`** + **`SUPABASE_SERVICE_ROLE_KEY`** are set, the API **seeds** in-memory turn history from the last rows in **`public.messages`** for each `chat_id` (helps restarts and extra workers). Same-process turns still use RAM; ensure the app saves messages to Supabase before the next `/chat` call for the tightest consistency across instances.

### CORS

`allow_credentials=True` requires **explicit** origins (not `*`). Set `CORS_ORIGINS` in `.env` as a comma-separated list (see `backend/.env.example`). Defaults include Vite dev URLs.

### Smoke tests

Use the same virtualenv as `uvicorn` (dependencies include LangChain / embeddings). The first run may take a while while the embedding model loads.

```bash
cd backend
venv\Scripts\activate
python -m unittest discover -s tests -p "test_*.py" -v
```

### Docker (small scale)

From the **`rag-chatbot`** directory (same level as `docker-compose.yml`):

1. **`backend/.env`** — copy from `backend/.env.example`, set `GROQ_API_KEY`, **`CORS_ORIGINS`** (must include the exact browser origin, e.g. `http://localhost:8080` when using compose below), and optional Supabase keys.
2. **`.env`** for Compose — copy `.env.compose.example` to `.env` and set `VITE_SUPABASE_*` and `VITE_CHAT_API_BASE` (use `http://localhost:8000` if the browser reaches the API on the host’s port 8000).
3. Run:

```bash
docker compose up --build
```

- SPA: **http://localhost:8080**
- API: **http://localhost:8000** (`GET /health`)

The API image runs **one** Uvicorn worker (fits in-memory rate limits). Rebuild the **`web`** image after any change to `VITE_*` variables.

## Frontend

```bash
cd frontend
copy .env.example .env.local   # set VITE_SUPABASE_* and VITE_CHAT_API_BASE
npm install
npm run dev
```

Usually http://localhost:5173 — ensure that origin is allowed by backend `CORS_ORIGINS`.

```bash
npm run lint
npm test   # Vitest (e.g. chat message helpers)
```

### Dashboard demo mode

If charts are empty (no `chat_metrics` rows yet), append **`?demo=1`** to the dashboard URL for illustrative metrics, or set **`VITE_DASHBOARD_DEMO=1`** and rebuild.

## Supabase

Apply SQL migrations under `supabase/migrations/` in order (see filenames). Includes `chat_metrics`, profiles, and optional **`rag_query_metrics`** (written by the Python API when `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are set and `chat_id` resolves in `chats`).

## Security notes

- Never expose **Supabase service role** or **Groq** keys to the browser.
- Frontend uses only the **anon** key; server-side metrics use the service role on the API host only.

## Deployment readiness

You can ship a **private beta** once secrets, CORS, and hosting are wired. Treat **full production** as ready when you have also handled the items below.

| Ready | Item |
|------:|------|
| Yes | `GROQ_API_KEY`, frontend `VITE_*` URLs, **`CORS_ORIGINS`** including your real site origin |
| Yes | **`ENVIRONMENT=production`** so `/docs` is off |
| Yes | Supabase migrations applied; **anon** key in the client; **service role** only on the API for metrics + message history seeding |
| Yes | Vector index / `backend/data/vector_store` present on the API host (see `/health`) |
| Yes | HTTPS in front of the API and the SPA for anything public-facing |
| Yes | **Frontend ESLint** — `npm run lint` is clean before release |
| Partial | **Rate limit** tuning (`CHAT_RATE_LIMIT`) and monitoring (Groq quota, errors) |
| Optional | Sticky sessions or a single API worker if you **disable** Supabase-backed history seeding; Redis-backed rate limits if many replicas sit behind one NAT IP |
