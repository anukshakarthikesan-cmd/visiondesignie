-- Planner vs learning thread: one chat = one conversation type (no mid-chat mode switch).
-- Stricter than a plain `text` column: NOT NULL + allowed values for production.
alter table public.chats
  add column if not exists chat_type text not null default 'planner'
  check (chat_type in ('planner', 'learning'));

comment on column public.chats.chat_type is 'planner = layout planning (FSM, PLAN_JSON); learning = concepts/teaching (RAG natural prose only)';
