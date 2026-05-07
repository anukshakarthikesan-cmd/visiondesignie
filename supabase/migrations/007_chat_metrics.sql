-- Per-completion analytics (RLS: own rows only). Run in Supabase SQL editor or via CLI.

create table if not exists public.chat_metrics (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  stage text not null,
  response_time_ms integer not null,
  structured boolean not null default false,
  approved boolean not null default false,
  user_input_preview text,
  assistant_message_id uuid references public.messages (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_chat_metrics_user_created
  on public.chat_metrics (user_id, created_at desc);

create index if not exists idx_chat_metrics_chat_created
  on public.chat_metrics (chat_id, created_at desc);

comment on table public.chat_metrics is
  'VisionDesignie assistant completion metrics; one row per persisted assistant reply from tracked streams.';

alter table public.chat_metrics enable row level security;

drop policy if exists "chat_metrics_select_own" on public.chat_metrics;
drop policy if exists "chat_metrics_insert_own" on public.chat_metrics;
drop policy if exists "chat_metrics_update_own" on public.chat_metrics;

create policy "chat_metrics_select_own"
  on public.chat_metrics
  for select
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.chats c
      where c.id = chat_metrics.chat_id and c.user_id = auth.uid()
    )
  );

create policy "chat_metrics_insert_own"
  on public.chat_metrics
  for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.chats c
      where c.id = chat_metrics.chat_id and c.user_id = auth.uid()
    )
  );

create policy "chat_metrics_update_own"
  on public.chat_metrics
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- KPI aggregates for the signed-in user (no cross-user leakage).
create or replace function public.dashboard_kpis()
returns table (
  accuracy_pct numeric,
  avg_response_ms numeric,
  approval_pct numeric,
  sample_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    round(100.0 * avg(case when structured then 1.0 else 0.0 end), 1) as accuracy_pct,
    round(avg(response_time_ms::numeric), 0) as avg_response_ms,
    round(100.0 * avg(case when approved then 1.0 else 0.0 end), 1) as approval_pct,
    count(*)::bigint as sample_count
  from public.chat_metrics
  where user_id = auth.uid();
$$;

grant execute on function public.dashboard_kpis() to authenticated;

-- Daily structured rate for line chart (last N calendar days with data).
create or replace function public.dashboard_accuracy_by_day(days_back int default 7)
returns table (
  day date,
  structured_pct numeric,
  sample_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    (created_at at time zone 'utc')::date as day,
    round(100.0 * avg(case when structured then 1.0 else 0.0 end), 1) as structured_pct,
    count(*)::bigint as sample_count
  from public.chat_metrics
  where user_id = auth.uid()
    and created_at >= (now() at time zone 'utc') - (days_back::text || ' days')::interval
  group by 1
  order by 1;
$$;

grant execute on function public.dashboard_accuracy_by_day(int) to authenticated;

-- Org-wide onboarding mix (aggregate only; SECURITY DEFINER).
create or replace function public.dashboard_onboarding_distribution()
returns table (
  onboarding_role text,
  cnt bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(nullif(trim(p.onboarding_role), ''), '(not set)') as onboarding_role,
    count(*)::bigint as cnt
  from public.profiles p
  group by 1
  order by 2 desc;
$$;

grant execute on function public.dashboard_onboarding_distribution() to authenticated;
