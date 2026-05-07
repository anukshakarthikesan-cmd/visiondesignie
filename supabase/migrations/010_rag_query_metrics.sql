-- RAG / retrieval analytics (per user turn). Apply after 007_chat_metrics.sql.
--
-- Today rag_pipeline.py does not INSERT here — add timing + scores from the Python
-- layer (or an Edge Function) when you instrument _compose_context_with_fallback /
-- stream paths. Columns are sized for:
--   • Layer latencies (FAISS + MMR + context build)
--   • Retrieval shape (k, fetch_k, doc counts, chars, fallback flag)
--   • Optional offline / eval metrics: mrr_at_k, ndcg_at_k need relevance labels or
--     a gold document id — leave NULL until an eval job or human labels populate them.
--
-- Service-role server writes bypass RLS; client JWT inserts must satisfy policies below.

create table if not exists public.rag_query_metrics (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  user_message_id uuid references public.messages (id) on delete set null,
  assistant_message_id uuid references public.messages (id) on delete set null,

  query_preview text,

  -- Wall-clock or CPU ms per layer (nullable until instrumented)
  retrieval_total_ms integer,
  faiss_search_ms integer,
  rerank_mmr_ms integer,
  context_build_ms integer,

  search_k integer not null default 3,
  fetch_k integer not null default 8,
  docs_returned integer,
  context_char_count integer,
  fallback_knowledge_appended boolean not null default false,

  -- Optional: rank of the single gold chunk in 1..fetch_k (eval / human labels)
  gold_doc_rank integer,
  mrr_at_10 numeric(10, 7),
  ndcg_at_10 numeric(10, 7),

  -- Optional: retriever scores / ids for debugging (small JSON arrays)
  doc_scores jsonb,

  created_at timestamptz not null default now()
);

comment on table public.rag_query_metrics is
  'Per-query RAG retrieval timings and optional IR metrics; populated by backend when instrumented.';

comment on column public.rag_query_metrics.retrieval_total_ms is
  'End-to-end retrieval + context assembly (ms) as measured server-side.';
comment on column public.rag_query_metrics.rerank_mmr_ms is
  'Optional: time spent in MMR reorder after fetch_k (LangChain mmr retriever).';
comment on column public.rag_query_metrics.mrr_at_10 is
  'Requires gold_doc_rank or batch eval; NULL for live traffic unless labeled.';
comment on column public.rag_query_metrics.ndcg_at_10 is
  'Requires graded relevance or eval pipeline; NULL for live traffic unless labeled.';

create index if not exists idx_rag_query_metrics_user_created
  on public.rag_query_metrics (user_id, created_at desc);

create index if not exists idx_rag_query_metrics_chat_created
  on public.rag_query_metrics (chat_id, created_at desc);

alter table public.rag_query_metrics enable row level security;

drop policy if exists "rag_query_metrics_select_own" on public.rag_query_metrics;
drop policy if exists "rag_query_metrics_insert_own" on public.rag_query_metrics;
drop policy if exists "rag_query_metrics_update_own" on public.rag_query_metrics;
drop policy if exists "rag_query_metrics_delete_own" on public.rag_query_metrics;

create policy "rag_query_metrics_select_own"
  on public.rag_query_metrics
  for select
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.chats c
      where c.id = rag_query_metrics.chat_id and c.user_id = auth.uid()
    )
  );

create policy "rag_query_metrics_insert_own"
  on public.rag_query_metrics
  for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.chats c
      where c.id = rag_query_metrics.chat_id and c.user_id = auth.uid()
    )
  );

create policy "rag_query_metrics_update_own"
  on public.rag_query_metrics
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "rag_query_metrics_delete_own"
  on public.rag_query_metrics
  for delete
  using (auth.uid() = user_id);

grant select, insert, update, delete on public.rag_query_metrics to authenticated;

-- ─── Dashboard RPCs (same security model as dashboard_kpis) ───────────────

create or replace function public.dashboard_rag_kpis()
returns table (
  sample_count bigint,
  avg_retrieval_total_ms numeric,
  avg_faiss_ms numeric,
  avg_rerank_mmr_ms numeric,
  avg_context_build_ms numeric,
  avg_docs_returned numeric,
  avg_context_chars numeric,
  pct_fallback numeric,
  avg_mrr_at_10 numeric,
  avg_ndcg_at_10 numeric,
  labeled_eval_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    count(*)::bigint as sample_count,
    round(avg(retrieval_total_ms::numeric), 1) as avg_retrieval_total_ms,
    round(avg(faiss_search_ms::numeric), 1) as avg_faiss_ms,
    round(avg(rerank_mmr_ms::numeric), 1) as avg_rerank_mmr_ms,
    round(avg(context_build_ms::numeric), 1) as avg_context_build_ms,
    round(avg(docs_returned::numeric), 2) as avg_docs_returned,
    round(avg(context_char_count::numeric), 0) as avg_context_chars,
    round(100.0 * avg(case when fallback_knowledge_appended then 1.0 else 0.0 end), 1) as pct_fallback,
    round(avg(mrr_at_10::numeric) filter (where mrr_at_10 is not null), 4) as avg_mrr_at_10,
    round(avg(ndcg_at_10::numeric) filter (where ndcg_at_10 is not null), 4) as avg_ndcg_at_10,
    count(*) filter (where mrr_at_10 is not null or ndcg_at_10 is not null)::bigint as labeled_eval_count
  from public.rag_query_metrics
  where user_id = auth.uid();
$$;

grant execute on function public.dashboard_rag_kpis() to authenticated;

-- Daily average retrieval latency (last N UTC days with at least one row).
create or replace function public.dashboard_rag_latency_by_day(days_back int default 14)
returns table (
  day date,
  avg_retrieval_ms numeric,
  sample_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    (created_at at time zone 'utc')::date as day,
    round(avg(retrieval_total_ms::numeric), 1) as avg_retrieval_ms,
    count(*)::bigint as sample_count
  from public.rag_query_metrics
  where user_id = auth.uid()
    and retrieval_total_ms is not null
    and created_at >= (now() at time zone 'utc') - (days_back::text || ' days')::interval
  group by 1
  order by 1;
$$;

grant execute on function public.dashboard_rag_latency_by_day(int) to authenticated;

-- Histogram bucket for retrieval_total_ms (for bar charts in dashboard UI).
create or replace function public.dashboard_rag_retrieval_histogram()
returns table (
  bucket text,
  cnt bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with b as (
    select
      case
        when retrieval_total_ms < 50 then '0–50ms'
        when retrieval_total_ms < 150 then '50–150ms'
        when retrieval_total_ms < 400 then '150–400ms'
        when retrieval_total_ms < 1000 then '400ms–1s'
        else '1s+'
      end as bucket
    from public.rag_query_metrics
    where user_id = auth.uid()
      and retrieval_total_ms is not null
  )
  select bucket, count(*)::bigint as cnt
  from b
  group by bucket
  order by
    case bucket
      when '0–50ms' then 1
      when '50–150ms' then 2
      when '150–400ms' then 3
      when '400ms–1s' then 4
      else 5
    end;
$$;

grant execute on function public.dashboard_rag_retrieval_histogram() to authenticated;

/*
Example insert (from FastAPI after timing retrieval — use the chat owner as user_id):

insert into public.rag_query_metrics (
  chat_id,
  user_id,
  user_message_id,
  query_preview,
  retrieval_total_ms,
  faiss_search_ms,
  rerank_mmr_ms,
  context_build_ms,
  search_k,
  fetch_k,
  docs_returned,
  context_char_count,
  fallback_knowledge_appended,
  doc_scores
) values (
  $1, $2, $3, left($4, 500),
  $5, $6, $7, $8,
  3, 8,
  $9, $10,
  $11,
  $12::jsonb
);

For labeled eval only, set gold_doc_rank, mrr_at_10, ndcg_at_10 from an offline script.
*/
