-- Create profiles table
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  created_at timestamptz not null default now()
);

-- Enable Row Level Security
alter table public.profiles enable row level security;

-- Drop existing policies (safe for re-run)
drop policy if exists "Users can insert own profile" on public.profiles;
drop policy if exists "Users can view own profile" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;

-- Policy: insert own profile
create policy "Users can insert own profile"
on public.profiles
for insert
with check (auth.uid() = id);

-- Policy: view own profile
create policy "Users can view own profile"
on public.profiles
for select
using (auth.uid() = id);

-- Policy: update own profile
create policy "Users can update own profile"
on public.profiles
for update
using (auth.uid() = id);