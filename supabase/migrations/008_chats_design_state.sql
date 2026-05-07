-- Persist FSM consultation state per chat (hydrated on open in Chat.jsx)
alter table public.chats
  add column if not exists design_state jsonb;

comment on column public.chats.design_state is
  'Client FSM JSON: plot_size, location, road_width, building_type, stage; optional last_updated (ISO) set by app for debugging/analytics';
