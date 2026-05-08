-- Per-chat floor plan snapshots (2D/3D source state) with monotonic version numbers.
-- Helps keep each chat as an independent design workspace and supports history/undo later.

create table if not exists public.chat_layout_versions (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  version integer not null,
  fingerprint text not null,
  design_state jsonb not null,
  layout_plan jsonb,
  layout_error text,
  created_at timestamptz not null default now(),
  unique (chat_id, version),
  unique (chat_id, fingerprint)
);

create index if not exists idx_chat_layout_versions_chat_created
  on public.chat_layout_versions (chat_id, created_at desc);

create index if not exists idx_chat_layout_versions_user_created
  on public.chat_layout_versions (user_id, created_at desc);

comment on table public.chat_layout_versions is
  'Versioned floor plan snapshots per chat. Captures design_state + derived layout payload.';

create or replace function public.chat_layout_versions_set_version()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.version is null or new.version <= 0 then
    select coalesce(max(v.version), 0) + 1
      into new.version
      from public.chat_layout_versions v
     where v.chat_id = new.chat_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_chat_layout_versions_set_version on public.chat_layout_versions;
create trigger trg_chat_layout_versions_set_version
before insert on public.chat_layout_versions
for each row
execute function public.chat_layout_versions_set_version();

alter table public.chat_layout_versions enable row level security;

drop policy if exists "chat_layout_versions_select_own" on public.chat_layout_versions;
drop policy if exists "chat_layout_versions_insert_own" on public.chat_layout_versions;

create policy "chat_layout_versions_select_own"
  on public.chat_layout_versions
  for select
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.chats c
      where c.id = chat_layout_versions.chat_id and c.user_id = auth.uid()
    )
  );

create policy "chat_layout_versions_insert_own"
  on public.chat_layout_versions
  for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.chats c
      where c.id = chat_layout_versions.chat_id and c.user_id = auth.uid()
    )
  );
