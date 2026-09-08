-- Server-only, shared across serverless instances. No credentials are stored.
create table if not exists public.morphly_session_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null,
  attempts integer not null check (attempts between 1 and 3)
);
alter table public.morphly_session_limits enable row level security;
revoke all on public.morphly_session_limits from public, anon, authenticated;
grant select, insert, update on public.morphly_session_limits to service_role;

create or replace function public.claim_morphly_session_attempt(p_user_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  claimed uuid;
  now_at timestamptz := clock_timestamp();
begin
  insert into public.morphly_session_limits as limits (user_id, window_started_at, attempts)
  values (p_user_id, now_at, 1)
  on conflict (user_id) do update
  set window_started_at = case when limits.window_started_at <= now_at - interval '60 seconds'
        then now_at else limits.window_started_at end,
      attempts = case when limits.window_started_at <= now_at - interval '60 seconds'
        then 1 else limits.attempts + 1 end
  where limits.window_started_at <= now_at - interval '60 seconds' or limits.attempts < 3
  returning user_id into claimed;
  return claimed is not null;
end;
$$;
revoke all on function public.claim_morphly_session_attempt(uuid) from public, anon, authenticated;
grant execute on function public.claim_morphly_session_attempt(uuid) to service_role;
