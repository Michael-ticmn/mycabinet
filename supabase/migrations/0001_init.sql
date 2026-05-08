-- Cabinet — initial schema + Storage bucket + RLS + share/guest plumbing.
--
-- One consolidated migration for the new Cabinet Supabase project.
-- Shape derived from mycellar's 0001…0015 sequence, with the spirits
-- domain swap applied (varietal→spirit_type, vintage→age_statement,
-- blend_components→mash_bill, style→category, body→intensity+proof,
-- drink_window→peak_window, request_type expanded for food/cigar/
-- occasion pairings + pour_tonight). Function prefix cellar27_→cabinet_;
-- allowlist/metrics tables renamed accordingly. Storage bucket name
-- (`bottle-labels`) is intentionally kept since "bottle" is neutral.
--
-- Apply via Supabase dashboard SQL editor or `supabase db push`.
-- Idempotent within reason: `if not exists` and `drop … if exists` used
-- so re-running on a partially-applied DB is safe.

------------------------------------------------------------
-- Tables
------------------------------------------------------------

create table if not exists bottles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null,

  -- Identity
  producer text not null,                       -- distillery/house
  expression_name text,                          -- e.g., "Old Forester 1920"

  -- Taxonomy
  category text not null check (category in (
    'bourbon','rye','american_whiskey_other',
    'scotch','irish_whiskey','japanese_whisky','world_whisky',
    'tequila','mezcal','agave_other',
    'rum','cognac','armagnac','brandy_other',
    'gin','vodka','liqueur','other'
  )),
  sub_type text,                                 -- per-category, validated app-side
  spirit_type text,                              -- free-form display, e.g. "Single Malt Scotch"

  -- Age / origin
  age_statement int,                             -- nullable = NAS
  release_year  int,
  region text,
  country text,

  -- Composition (jsonb — flexible across grain/agave/cask blend shapes)
  mash_bill jsonb,                               -- {grain:{corn:70,rye:21,malt:9}} | {agave:"blue weber"} | {cask:["bourbon","px"]}

  -- Strength + character
  proof numeric(6,2),                            -- DB stores proof; UI may toggle ABV
  cask_type text,
  cask_strength boolean not null default false,
  single_barrel boolean not null default false,
  finish text,                                   -- "Madeira finish, 18mo"
  sweetness text check (sweetness in ('dry','off_dry','sweet')),
  intensity int check (intensity between 1 and 5),

  -- Inventory
  quantity int not null default 1 check (quantity >= 0),
  storage_location text,
  acquired_date date,
  acquired_price numeric(10,2),

  -- Maturation guidance window (years from acquisition; spirits don't
  -- typically age in bottle, so window stays open — kept for shape parity).
  peak_window_start int,
  peak_window_end int,
  peak_window_overridden boolean not null default false,

  -- Notes + media
  notes text,
  label_image_path text,
  back_image_path text,
  details jsonb,                                  -- AI scan enrichment

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Soft size caps (defensive against runaway inserts).
  constraint bottles_producer_len      check (length(producer) <= 200),
  constraint bottles_expression_len    check (expression_name is null or length(expression_name) <= 200),
  constraint bottles_notes_len         check (notes is null or length(notes) <= 4000),
  constraint bottles_storage_loc_len   check (storage_location is null or length(storage_location) <= 200),
  constraint bottles_details_size      check (details is null or octet_length(details::text) <= 8192),
  constraint bottles_mash_bill_size    check (mash_bill is null or octet_length(mash_bill::text) <= 4096)
);

create index if not exists bottles_user_idx          on bottles(user_id);
create index if not exists bottles_peak_window_idx   on bottles(peak_window_start, peak_window_end);
create index if not exists bottles_category_idx      on bottles(user_id, category);

create table if not exists pairing_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null,
  created_at timestamptz not null default now(),
  request_type text not null check (request_type in (
    'pair_food','pair_cigar','pair_occasion',
    'flight','pour_tonight','flight_plan','flight_guest'
  )),
  context jsonb not null,
  cabinet_snapshot jsonb not null,
  status text not null default 'pending' check (status in ('pending','picked_up','completed','error')),
  picked_up_at timestamptz,
  claimed_by  text,
  retry_count int not null default 0,
  share_link_id uuid,                              -- FK added below after share_links exists
  error_message text,

  constraint pairing_requests_context_size  check (octet_length(context::text) <= 4096),
  constraint pairing_requests_snapshot_size check (octet_length(cabinet_snapshot::text) <= 65536),
  constraint pairing_requests_claimed_by_when_picked_up check (status <> 'picked_up' or claimed_by is not null)
);

create index if not exists pairing_requests_status_idx       on pairing_requests(status, created_at);
create index if not exists pairing_requests_user_idx         on pairing_requests(user_id);
create index if not exists pairing_requests_user_created_idx on pairing_requests(user_id, created_at desc);

create table if not exists pairing_responses (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references pairing_requests(id) on delete cascade not null,
  created_at timestamptz not null default now(),
  recommendations jsonb not null,
  narrative text,
  payload jsonb
);

create unique index if not exists pairing_responses_request_idx on pairing_responses(request_id);

create table if not exists scan_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null,
  created_at timestamptz not null default now(),
  intent text not null check (intent in ('add','pour','enrich')),
  image_paths jsonb not null default '[]'::jsonb,
  context jsonb,
  cabinet_snapshot jsonb,
  status text not null default 'pending' check (status in ('pending','picked_up','completed','error')),
  picked_up_at timestamptz,
  claimed_by  text,
  retry_count int not null default 0,
  error_message text,

  constraint scan_requests_context_size      check (context is null or octet_length(context::text) <= 4096),
  constraint scan_requests_snapshot_size     check (cabinet_snapshot is null or octet_length(cabinet_snapshot::text) <= 65536),
  constraint scan_requests_image_paths_size  check (octet_length(image_paths::text) <= 4096),
  constraint scan_requests_image_paths_count check (
    (intent = 'enrich' and jsonb_array_length(image_paths) = 0)
    or (intent in ('add','pour') and jsonb_array_length(image_paths) between 1 and 4)
  ),
  constraint scan_requests_claimed_by_when_picked_up check (status <> 'picked_up' or claimed_by is not null)
);

create index if not exists scan_requests_status_idx       on scan_requests(status, created_at);
create index if not exists scan_requests_user_idx         on scan_requests(user_id);
create index if not exists scan_requests_user_created_idx on scan_requests(user_id, created_at desc);

create table if not exists scan_responses (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references scan_requests(id) on delete cascade not null,
  created_at timestamptz not null default now(),
  extracted jsonb,
  matched_bottle_id uuid references bottles(id),
  match_candidates jsonb,
  narrative text
);

create unique index if not exists scan_responses_request_idx on scan_responses(request_id);

------------------------------------------------------------
-- Allowlist (gate for owner-side request creation) + watcher metrics
------------------------------------------------------------

create table if not exists cabinet_allowed_users (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now(),
  note     text
);

alter table cabinet_allowed_users enable row level security;

drop policy if exists "users read own allowlist row" on cabinet_allowed_users;
create policy "users read own allowlist row" on cabinet_allowed_users
  for select to authenticated using (user_id = auth.uid());

create table if not exists cabinet_watcher_metrics (
  metric_date date primary key,
  spawn_count int  not null default 0,
  updated_at  timestamptz not null default now()
);

alter table cabinet_watcher_metrics enable row level security;
-- No policies → service_role only.

------------------------------------------------------------
-- Share links + guest plan + guest messages
------------------------------------------------------------

create table if not exists share_links (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null references auth.users(id) on delete cascade,
  token          text not null unique,
  expires_at     timestamptz not null,
  ai_quota       int  not null default 20 check (ai_quota >= 0),
  ai_used        int  not null default 0  check (ai_used  >= 0),
  revoked_at     timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists share_links_owner_idx  on share_links(owner_user_id);
create index if not exists share_links_active_idx on share_links(token) where revoked_at is null;

alter table share_links enable row level security;

drop policy if exists "owners read own share links" on share_links;
create policy "owners read own share links" on share_links
  for select to authenticated using (auth.uid() = owner_user_id);

drop policy if exists "owners revoke own share links" on share_links;
create policy "owners revoke own share links" on share_links
  for update to authenticated
  using (auth.uid() = owner_user_id)
  with check (auth.uid() = owner_user_id);

-- Hook pairing_requests.share_link_id FK now that share_links exists.
alter table pairing_requests
  drop constraint if exists pairing_requests_share_link_id_fkey;
alter table pairing_requests
  add constraint pairing_requests_share_link_id_fkey
  foreign key (share_link_id) references share_links(id) on delete set null;

create index if not exists pairing_requests_share_link_idx
  on pairing_requests(share_link_id) where share_link_id is not null;

create table if not exists planned_flights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  title text,
  occasion_date date,
  source_request_id uuid references pairing_requests(id) on delete set null,
  theme text,
  guests int,
  narrative text not null,
  picks jsonb not null,
  -- pairings: jsonb with `kind` discriminator: 'food' | 'cigar' | 'occasion'.
  pairings jsonb,
  -- prep: spirits-shaped — chill_min, open_early_min (was decant), glassware,
  -- water_drops, plus any free-form notes the AI surfaces.
  prep jsonb,
  user_notes text,
  food_hint  text,                    -- original host intent (write-once)
  notes_hint text,                    -- original host intent (write-once)
  shared_via_link_id uuid references share_links(id) on delete set null,
  guest_view jsonb
);

create index if not exists planned_flights_user_idx
  on planned_flights(user_id, occasion_date nulls last, created_at desc);
create unique index if not exists planned_flights_shared_link_uidx
  on planned_flights(shared_via_link_id) where shared_via_link_id is not null;

alter table planned_flights enable row level security;

drop policy if exists "users see own planned flights"   on planned_flights;
drop policy if exists "users insert own planned flights" on planned_flights;
drop policy if exists "users update own planned flights" on planned_flights;
drop policy if exists "users delete own planned flights" on planned_flights;

create policy "users see own planned flights" on planned_flights
  for select using (auth.uid() = user_id);
create policy "users insert own planned flights" on planned_flights
  for insert with check (auth.uid() = user_id);
create policy "users update own planned flights" on planned_flights
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users delete own planned flights" on planned_flights
  for delete using (auth.uid() = user_id);

create table if not exists guest_messages (
  id            uuid primary key default gen_random_uuid(),
  share_link_id uuid not null references share_links(id) on delete cascade,
  created_at    timestamptz not null default now(),
  guest_name    text,
  kind          text not null check (kind in ('ai_result', 'pour_note')),
  payload       jsonb not null
  -- payload shape by kind:
  --   ai_result: { request_type, context, recommendations, narrative }
  --   pour_note: { planned_flight_id, bottle_id, note }
);

create index if not exists guest_messages_link_idx
  on guest_messages(share_link_id, created_at desc);

alter table guest_messages enable row level security;

drop policy if exists "owners read guest messages on their links" on guest_messages;
create policy "owners read guest messages on their links" on guest_messages
  for select to authenticated using (
    exists (select 1 from share_links sl
            where sl.id = guest_messages.share_link_id
              and sl.owner_user_id = auth.uid())
  );

------------------------------------------------------------
-- Triggers
------------------------------------------------------------

create or replace function set_updated_at()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin new.updated_at := now(); return new; end;
$$;

drop trigger if exists bottles_updated_at on bottles;
create trigger bottles_updated_at before update on bottles
  for each row execute function set_updated_at();

drop trigger if exists planned_flights_touch on planned_flights;
create trigger planned_flights_touch before update on planned_flights
  for each row execute function set_updated_at();

------------------------------------------------------------
-- Per-user pending-request cap (5 in flight max)
------------------------------------------------------------

create or replace function enforce_pending_request_cap()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
declare pending_count int; cap int := 5;
begin
  select count(*) into pending_count
  from public.pairing_requests
  where user_id = new.user_id
    and status in ('pending','picked_up');
  if pending_count >= cap then
    raise exception 'Too many pending requests (%): wait for the bridge to finish before submitting more.', pending_count
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists pairing_requests_cap on pairing_requests;
create trigger pairing_requests_cap
  before insert on pairing_requests
  for each row execute function enforce_pending_request_cap();

create or replace function enforce_pending_scan_cap()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
declare pending_count int; cap int := 5;
begin
  select count(*) into pending_count
  from public.scan_requests
  where user_id = new.user_id
    and status in ('pending','picked_up');
  if pending_count >= cap then
    raise exception 'Too many pending scans (%): wait for processing to finish.', pending_count
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists scan_requests_cap on scan_requests;
create trigger scan_requests_cap
  before insert on scan_requests
  for each row execute function enforce_pending_scan_cap();

------------------------------------------------------------
-- Owner-side rate limit, stale-claim sweep, daily ceiling
------------------------------------------------------------

create or replace function cabinet_check_rate_limit(
  p_user_id        uuid,
  p_max            int default 100,
  p_window_minutes int default 60
) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select (
    (select count(*) from public.pairing_requests
       where user_id = p_user_id
         and created_at > now() - make_interval(mins => p_window_minutes))
    +
    (select count(*) from public.scan_requests
       where user_id = p_user_id
         and created_at > now() - make_interval(mins => p_window_minutes))
  ) < p_max;
$$;

revoke all on function cabinet_check_rate_limit(uuid, int, int) from public;
grant execute on function cabinet_check_rate_limit(uuid, int, int) to authenticated;

create or replace function cabinet_sweep_stale_claims(
  p_timeout_minutes int default 10,
  p_max_retries     int default 2
) returns table(table_name text, request_id uuid, action text)
language plpgsql security definer set search_path = pg_catalog, public as $$
declare cutoff timestamptz := now() - make_interval(mins => p_timeout_minutes);
begin
  return query
  with retry as (
    update public.pairing_requests
       set status='pending', picked_up_at=null, claimed_by=null,
           retry_count = retry_count + 1
     where status='picked_up' and picked_up_at < cutoff and retry_count < p_max_retries
    returning id
  )
  select 'pairing_requests'::text, id, 'retry'::text from retry;

  return query
  with fail as (
    update public.pairing_requests
       set status='error',
           error_message = format('stale: no completion after %s retries', p_max_retries)
     where status='picked_up' and picked_up_at < cutoff and retry_count >= p_max_retries
    returning id
  )
  select 'pairing_requests'::text, id, 'fail'::text from fail;

  return query
  with retry as (
    update public.scan_requests
       set status='pending', picked_up_at=null, claimed_by=null,
           retry_count = retry_count + 1
     where status='picked_up' and picked_up_at < cutoff and retry_count < p_max_retries
    returning id
  )
  select 'scan_requests'::text, id, 'retry'::text from retry;

  return query
  with fail as (
    update public.scan_requests
       set status='error',
           error_message = format('stale: no completion after %s retries', p_max_retries)
     where status='picked_up' and picked_up_at < cutoff and retry_count >= p_max_retries
    returning id
  )
  select 'scan_requests'::text, id, 'fail'::text from fail;
end $$;

revoke all on function cabinet_sweep_stale_claims(int, int) from public;

create or replace function cabinet_try_record_spawn(p_max int)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public as $$
declare incremented int;
begin
  insert into public.cabinet_watcher_metrics(metric_date, spawn_count)
    values (current_date, 0)
    on conflict (metric_date) do nothing;

  update public.cabinet_watcher_metrics
     set spawn_count = spawn_count + 1, updated_at = now()
   where metric_date = current_date and spawn_count < p_max
  returning spawn_count into incremented;

  return incremented is not null;
end $$;

revoke all on function cabinet_try_record_spawn(int) from public;

------------------------------------------------------------
-- Owner-side RLS on requests (split SELECT/UPDATE/INSERT so we can
-- attach the allowlist + rate-limit checks to INSERT only).
------------------------------------------------------------

alter table bottles            enable row level security;
alter table pairing_requests   enable row level security;
alter table pairing_responses  enable row level security;
alter table scan_requests      enable row level security;
alter table scan_responses     enable row level security;

drop policy if exists "users see own bottles" on bottles;
create policy "users see own bottles" on bottles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "users select own pairing requests" on pairing_requests;
drop policy if exists "users update own pairing requests" on pairing_requests;
drop policy if exists "users insert own pairing requests" on pairing_requests;

create policy "users select own pairing requests" on pairing_requests
  for select to authenticated using (auth.uid() = user_id);

create policy "users update own pairing requests" on pairing_requests
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "users insert own pairing requests" on pairing_requests
  for insert to authenticated with check (
    auth.uid() = user_id
    and exists (select 1 from public.cabinet_allowed_users where user_id = auth.uid())
    and public.cabinet_check_rate_limit(auth.uid())
  );

drop policy if exists "users see responses to own pairing requests" on pairing_responses;
create policy "users see responses to own pairing requests" on pairing_responses
  for select using (
    exists (select 1 from pairing_requests pr
            where pr.id = pairing_responses.request_id and pr.user_id = auth.uid())
  );

drop policy if exists "users select own scan requests" on scan_requests;
drop policy if exists "users update own scan requests" on scan_requests;
drop policy if exists "users insert own scan requests" on scan_requests;

create policy "users select own scan requests" on scan_requests
  for select to authenticated using (auth.uid() = user_id);

create policy "users update own scan requests" on scan_requests
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "users insert own scan requests" on scan_requests
  for insert to authenticated with check (
    auth.uid() = user_id
    and exists (select 1 from public.cabinet_allowed_users where user_id = auth.uid())
    and public.cabinet_check_rate_limit(auth.uid())
  );

drop policy if exists "users see responses to own scan requests" on scan_responses;
create policy "users see responses to own scan requests" on scan_responses
  for select using (
    exists (select 1 from scan_requests sr
            where sr.id = scan_responses.request_id and sr.user_id = auth.uid())
  );

------------------------------------------------------------
-- Share-link RPCs (anon-callable; SECURITY DEFINER)
------------------------------------------------------------

create or replace function cabinet_share_resolve(p_token text)
returns table (
  expires_at  timestamptz,
  ai_quota    int,
  ai_used     int
)
language sql stable security definer set search_path = pg_catalog, public as $$
  select expires_at, ai_quota, ai_used
    from public.share_links
   where token       = p_token
     and revoked_at is null
     and expires_at  > now();
$$;

revoke all on function cabinet_share_resolve(text) from public;
grant execute on function cabinet_share_resolve(text) to anon, authenticated;

create or replace function cabinet_share_list_bottles(p_token text)
returns table (
  id                 uuid,
  producer           text,
  expression_name    text,
  category           text,
  sub_type           text,
  spirit_type        text,
  age_statement      int,
  release_year       int,
  region             text,
  country            text,
  mash_bill          jsonb,
  proof              numeric,
  cask_type          text,
  cask_strength      boolean,
  single_barrel      boolean,
  finish             text,
  sweetness          text,
  intensity          int,
  quantity           int,
  peak_window_start  int,
  peak_window_end    int,
  details            jsonb
)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_owner uuid;
begin
  select owner_user_id into v_owner
    from public.share_links
   where token       = p_token
     and revoked_at is null
     and expires_at  > now();
  if v_owner is null then
    raise exception 'link_invalid' using errcode = 'P0001';
  end if;

  return query
    select b.id, b.producer, b.expression_name, b.category, b.sub_type,
           b.spirit_type, b.age_statement, b.release_year, b.region, b.country,
           b.mash_bill, b.proof, b.cask_type, b.cask_strength, b.single_barrel,
           b.finish, b.sweetness, b.intensity, b.quantity,
           b.peak_window_start, b.peak_window_end, b.details
      from public.bottles b
     where b.user_id = v_owner;
end $$;

revoke all on function cabinet_share_list_bottles(text) from public;
grant execute on function cabinet_share_list_bottles(text) to anon, authenticated;

create or replace function cabinet_share_create_pairing_request(
  p_token        text,
  p_request_type text,
  p_context      jsonb
) returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_link_id  uuid;
  v_owner    uuid;
  v_snapshot jsonb;
  v_req_id   uuid;
  v_recent   int;
begin
  if p_request_type not in ('pair_food','pair_cigar','pair_occasion','flight','pour_tonight') then
    raise exception 'invalid_request_type' using errcode = 'P0001';
  end if;

  select id, owner_user_id into v_link_id, v_owner
    from public.share_links
   where token       = p_token
     and revoked_at is null
     and expires_at  > now();
  if v_link_id is null then
    raise exception 'link_invalid' using errcode = 'P0001';
  end if;

  select count(*) into v_recent
    from public.pairing_requests
   where share_link_id = v_link_id
     and created_at    > now() - interval '2 seconds';
  if v_recent > 0 then
    raise exception 'rate_too_fast' using errcode = 'P0001';
  end if;

  update public.share_links
     set ai_used = ai_used + 1
   where id          = v_link_id
     and revoked_at is null
     and expires_at  > now()
     and ai_used     < ai_quota
  returning id into v_link_id;
  if v_link_id is null then
    raise exception 'quota_exhausted' using errcode = 'P0001';
  end if;

  -- Sanitized cabinet snapshot — must match snapshotForBridge in
  -- docs/js/pairings.js (no price, no notes, no storage location, no user_id).
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',                b.id,
           'producer',          b.producer,
           'expression_name',   b.expression_name,
           'category',          b.category,
           'sub_type',          b.sub_type,
           'spirit_type',       b.spirit_type,
           'age_statement',     b.age_statement,
           'release_year',      b.release_year,
           'region',            b.region,
           'country',           b.country,
           'mash_bill',         b.mash_bill,
           'proof',             b.proof,
           'cask_type',         b.cask_type,
           'cask_strength',     b.cask_strength,
           'single_barrel',     b.single_barrel,
           'finish',            b.finish,
           'sweetness',         b.sweetness,
           'intensity',         b.intensity,
           'quantity',          b.quantity,
           'peak_window_start', b.peak_window_start,
           'peak_window_end',   b.peak_window_end
         )), '[]'::jsonb)
    into v_snapshot
    from public.bottles b
   where b.user_id = v_owner;

  insert into public.pairing_requests (user_id, request_type, context, cabinet_snapshot, share_link_id)
       values (v_owner, p_request_type, p_context, v_snapshot, v_link_id)
    returning id into v_req_id;

  return v_req_id;
end $$;

revoke all on function cabinet_share_create_pairing_request(text, text, jsonb) from public;
grant execute on function cabinet_share_create_pairing_request(text, text, jsonb) to anon, authenticated;

create or replace function cabinet_share_get_response(
  p_token      text,
  p_request_id uuid
) returns table (
  status          text,
  error_message   text,
  recommendations jsonb,
  narrative       text
)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  return query
    select pr.status, pr.error_message, presp.recommendations, presp.narrative
      from public.pairing_requests pr
      join public.share_links sl on sl.id = pr.share_link_id
      left join public.pairing_responses presp on presp.request_id = pr.id
     where pr.id    = p_request_id
       and sl.token = p_token;
end $$;

revoke all on function cabinet_share_get_response(text, uuid) from public;
grant execute on function cabinet_share_get_response(text, uuid) to anon, authenticated;

create or replace function cabinet_share_create(
  p_ttl_hours int,
  p_ai_quota  int
) returns table (
  id          uuid,
  token       text,
  expires_at  timestamptz,
  ai_quota    int,
  ai_used     int
)
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_uid   uuid := auth.uid();
  v_token text;
  v_ttl   int  := greatest(1, least(p_ttl_hours, 168));   -- 1h … 7d ceiling
  v_quota int  := greatest(1, least(p_ai_quota, 50));     -- 1 … 50
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.cabinet_allowed_users where user_id = v_uid) then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;

  update public.share_links
     set revoked_at = now()
   where owner_user_id = v_uid
     and revoked_at is null;

  v_token := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_');

  return query
    insert into public.share_links (owner_user_id, token, expires_at, ai_quota)
    values (v_uid, v_token, now() + make_interval(hours => v_ttl), v_quota)
    returning share_links.id, share_links.token, share_links.expires_at,
              share_links.ai_quota, share_links.ai_used;
end $$;

revoke all on function cabinet_share_create(int, int) from public;
grant execute on function cabinet_share_create(int, int) to authenticated;

create or replace function cabinet_share_get_planned_flight(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  v_link_id uuid;
  v_owner   uuid;
  v_plan    public.planned_flights%rowtype;
  v_bottles jsonb;
begin
  select id, owner_user_id into v_link_id, v_owner
    from public.share_links
   where token       = p_token
     and revoked_at is null
     and expires_at  > now();
  if v_link_id is null then
    raise exception 'link_invalid' using errcode = 'P0001';
  end if;

  select * into v_plan
    from public.planned_flights
   where shared_via_link_id = v_link_id
     and user_id = v_owner;
  if v_plan.id is null then
    return null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',                b.id,
           'producer',          b.producer,
           'expression_name',   b.expression_name,
           'category',          b.category,
           'sub_type',          b.sub_type,
           'spirit_type',       b.spirit_type,
           'age_statement',     b.age_statement,
           'release_year',      b.release_year,
           'region',            b.region,
           'country',           b.country,
           'mash_bill',         b.mash_bill,
           'proof',             b.proof,
           'cask_type',         b.cask_type,
           'cask_strength',     b.cask_strength,
           'single_barrel',     b.single_barrel,
           'finish',            b.finish,
           'sweetness',         b.sweetness,
           'intensity',         b.intensity,
           'peak_window_start', b.peak_window_start,
           'peak_window_end',   b.peak_window_end,
           'details',           b.details
         )), '[]'::jsonb)
    into v_bottles
    from public.bottles b
   where b.user_id = v_owner
     and b.id = any (
       select (elem->>'bottle_id')::uuid
         from jsonb_array_elements(v_plan.picks) elem
     );

  return jsonb_build_object(
    'id',            v_plan.id,
    'title',         v_plan.title,
    'occasion_date', v_plan.occasion_date,
    'theme',         v_plan.theme,
    'guests',        v_plan.guests,
    'narrative',     v_plan.narrative,
    'picks',         v_plan.picks,
    'pairings',      v_plan.pairings,
    'guest_view',    v_plan.guest_view,
    'bottles',       v_bottles
  );
end $$;

revoke all on function cabinet_share_get_planned_flight(text) from public;
grant execute on function cabinet_share_get_planned_flight(text) to anon, authenticated;

create or replace function cabinet_share_create_message(
  p_token      text,
  p_guest_name text,
  p_kind       text,
  p_payload    jsonb
) returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_link_id uuid;
  v_id      uuid;
begin
  if p_kind not in ('ai_result', 'pour_note') then
    raise exception 'invalid_kind' using errcode = 'P0001';
  end if;
  if p_payload is null or octet_length(p_payload::text) > 32768 then
    raise exception 'payload_too_large' using errcode = 'P0001';
  end if;

  select id into v_link_id
    from public.share_links
   where token       = p_token
     and revoked_at is null
     and expires_at  > now();
  if v_link_id is null then
    raise exception 'link_invalid' using errcode = 'P0001';
  end if;

  insert into public.guest_messages (share_link_id, guest_name, kind, payload)
  values (v_link_id, nullif(trim(p_guest_name), ''), p_kind, p_payload)
  returning id into v_id;
  return v_id;
end $$;

revoke all on function cabinet_share_create_message(text, text, text, jsonb) from public;
grant execute on function cabinet_share_create_message(text, text, text, jsonb) to anon, authenticated;

------------------------------------------------------------
-- Storage bucket for bottle label photos (name kept neutral)
------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('bottle-labels', 'bottle-labels', false)
on conflict (id) do nothing;

drop policy if exists "users upload own labels" on storage.objects;
create policy "users upload own labels" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'bottle-labels'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "users read own labels" on storage.objects;
create policy "users read own labels" on storage.objects
  for select to authenticated using (
    bucket_id = 'bottle-labels'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "users update own labels" on storage.objects;
create policy "users update own labels" on storage.objects
  for update to authenticated using (
    bucket_id = 'bottle-labels'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "users delete own labels" on storage.objects;
create policy "users delete own labels" on storage.objects
  for delete to authenticated using (
    bucket_id = 'bottle-labels'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Seed cabinet_allowed_users with each real user's id after applying.
