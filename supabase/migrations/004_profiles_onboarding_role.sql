-- Persist "About you" / onboarding role from ProfileSetup
alter table public.profiles
  add column if not exists onboarding_role text;

comment on column public.profiles.onboarding_role is
  'User-chosen role from onboarding (preset value or custom text for Other).';
