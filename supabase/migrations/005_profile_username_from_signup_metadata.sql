-- Ensure profiles.username uses signUp({ options: { data: { username } } })
-- (stored on auth.users.raw_user_meta_data). Adds fallbacks if the key is missing.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  chosen text;
  meta jsonb;
begin
  meta := coalesce(new.raw_user_meta_data, '{}'::jsonb);

  chosen := nullif(
    trim(
      coalesce(
        nullif(trim(meta->>'username'), ''),
        nullif(trim(meta->>'user_name'), ''),
        nullif(trim(meta->>'name'), ''),
        nullif(trim(meta->>'full_name'), '')
      )
    ),
    ''
  );

  if chosen is null and new.email is not null and position('@' in new.email) > 1 then
    chosen := nullif(trim(split_part(new.email, '@', 1)), '');
  end if;

  if chosen is null then
    chosen := 'user_' || substr(replace(new.id::text, '-', ''), 1, 8);
  end if;

  insert into public.profiles (id, username)
  values (new.id, chosen);
  return new;
end;
$$;
