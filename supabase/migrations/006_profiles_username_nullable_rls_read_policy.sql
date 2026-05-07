-- Allow profile rows with only id (frontend fallback insert; trigger still sets username on signup)
alter table public.profiles
  alter column username drop not null;

-- Align SELECT policy name with app docs (same rule as before)
drop policy if exists "Users can view own profile" on public.profiles;
drop policy if exists "Users can read own profile" on public.profiles;

create policy "Users can read own profile"
on public.profiles
for select
using (auth.uid() = id);
