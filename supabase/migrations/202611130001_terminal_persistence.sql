-- PostgreSQL / Supabase. Apply once through migrations or the SQL editor.
-- Sites supplies the authenticated owner ID to server-only RPC calls.
-- Browser roles deliberately have no table or RPC access.

create table public.terminal_profiles (
  owner_id text primary key check (length(btrim(owner_id)) between 1 and 255),
  display_name text not null check (length(display_name) <= 255),
  email text not null check (length(email) <= 320),
  revision bigint not null default 0 check (revision between 0 and 9007199254740991),
  initialized boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.terminal_preferences (
  owner_id text primary key references public.terminal_profiles(owner_id) on delete cascade,
  risk_free_rate numeric not null check (risk_free_rate between 0 and 0.25)
);

create table public.watchlists (
  owner_id text not null references public.terminal_profiles(owner_id) on delete cascade,
  list_id text not null check (length(btrim(list_id)) between 1 and 128),
  position integer not null check (position >= 0),
  -- Name, selected strategy, core scores and analysis configuration.
  -- Symbols are normalized in watchlist_items; id belongs to the composite key.
  metadata jsonb not null check ((jsonb_typeof(metadata) = 'object'
    and jsonb_typeof(metadata -> 'name') = 'string'
    and length(btrim(metadata ->> 'name')) between 1 and 128
    and not metadata ? 'id' and not metadata ? 'symbols') is true),
  primary key (owner_id, list_id),
  unique (owner_id, position)
);

create table public.watchlist_items (
  owner_id text not null,
  list_id text not null,
  position integer not null check (position >= 0),
  symbol text not null check (length(btrim(symbol)) between 1 and 32),
  primary key (owner_id, list_id, position),
  unique (owner_id, list_id, symbol),
  foreign key (owner_id, list_id) references public.watchlists(owner_id, list_id) on delete cascade
);
create index watchlist_items_owner_symbol_idx on public.watchlist_items(owner_id, symbol);

create table public.paper_orders (
  owner_id text not null references public.terminal_profiles(owner_id) on delete cascade,
  order_id text not null check (length(btrim(order_id)) between 1 and 128),
  position integer not null check (position >= 0),
  -- JSONB preserves decimal numbers and the existing simulated-order contract.
  payload jsonb not null,
  symbol text generated always as (payload ->> 'symbol') stored,
  side text generated always as (payload ->> 'side') stored,
  primary key (owner_id, order_id),
  unique (owner_id, position),
  check ((jsonb_typeof(payload) = 'object' and not payload ? 'id'
    and jsonb_typeof(payload -> 'symbol') = 'string'
    and length(btrim(payload ->> 'symbol')) between 1 and 32
    and payload ->> 'side' in ('buy', 'sell')
    and payload ->> 'type' in ('call', 'put')
    and payload ->> 'status' = 'Simulada'
    and jsonb_typeof(payload -> 'quantity') = 'number'
    and (payload ->> 'quantity')::numeric between 1 and 100
    and (payload ->> 'quantity')::numeric = trunc((payload ->> 'quantity')::numeric)
    and jsonb_typeof(payload -> 'strike') = 'number' and (payload ->> 'strike')::numeric > 0
    and jsonb_typeof(payload -> 'premium') = 'number' and (payload ->> 'premium')::numeric >= 0
    and jsonb_typeof(payload -> 'total') = 'number' and (payload ->> 'total')::numeric >= 0
    and jsonb_typeof(payload -> 'createdAt') = 'string'
    and jsonb_typeof(payload -> 'expiry') = 'string') is true)
);
create index paper_orders_owner_symbol_idx on public.paper_orders(owner_id, symbol);
create index paper_orders_owner_created_idx on public.paper_orders(owner_id, ((payload ->> 'createdAt')));

create table public.investment_cycles (
  owner_id text not null references public.terminal_profiles(owner_id) on delete cascade,
  cycle_id text not null check (length(btrim(cycle_id)) between 1 and 128),
  position integer not null check (position >= 0),
  -- A cycle is one atomic aggregate: config, legs, events and cash move together.
  -- Its complete state lives here; MongoDB only receives immutable archives.
  state jsonb not null,
  symbol text generated always as (state ->> 'symbol') stored,
  strategy text generated always as (state ->> 'strategy') stored,
  phase text generated always as (state ->> 'phase') stored,
  primary key (owner_id, cycle_id),
  unique (owner_id, position),
  check ((jsonb_typeof(state) = 'object' and not state ? 'id'
    and state -> 'version' = '1'::jsonb
    and jsonb_typeof(state -> 'symbol') = 'string'
    and length(btrim(state ->> 'symbol')) between 1 and 32
    and state ->> 'strategy' in ('wheel', 'pmcc', 'backspread', 'gamma')
    and state ->> 'phase' in ('put', 'shares', 'covered-call', 'active', 'pmcc-long', 'pmcc-assigned', 'closed')
    and jsonb_typeof(state -> 'config') = 'object'
    and jsonb_typeof(state -> 'legs') = 'array'
    and jsonb_typeof(state -> 'events') = 'array'
    and jsonb_typeof(state -> 'cash') = 'number'
    and jsonb_typeof(state -> 'shares') = 'number') is true)
);
create index investment_cycles_owner_phase_idx on public.investment_cycles(owner_id, phase);
create index investment_cycles_owner_symbol_idx on public.investment_cycles(owner_id, symbol);

create table public.analysis_outbox (
  snapshot_id uuid primary key default gen_random_uuid(),
  owner_id text not null references public.terminal_profiles(owner_id) on delete cascade,
  revision bigint not null check (revision > 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  unique (owner_id, revision)
);
create index analysis_outbox_pending_idx on public.analysis_outbox(owner_id, revision) where delivered_at is null;

alter table public.terminal_profiles enable row level security;
alter table public.terminal_preferences enable row level security;
alter table public.watchlists enable row level security;
alter table public.watchlist_items enable row level security;
alter table public.paper_orders enable row level security;
alter table public.investment_cycles enable row level security;
alter table public.analysis_outbox enable row level security;

revoke all on public.terminal_profiles, public.terminal_preferences, public.watchlists,
  public.watchlist_items, public.paper_orders, public.investment_cycles, public.analysis_outbox
  from public, anon, authenticated;

create function public.load_terminal_state(p_owner_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.terminal_profiles%rowtype;
  v_lists jsonb;
  v_orders jsonb;
  v_cycles jsonb;
  v_rate numeric;
  v_pending bigint;
begin
  -- Keep the revision and all aggregates on the same committed version while
  -- the several read statements below execute under READ COMMITTED.
  select * into v_profile from public.terminal_profiles where owner_id = p_owner_id for share;
  if not found or not v_profile.initialized then
    return jsonb_build_object('revision', 0, 'state', null, 'pendingArchives', 0);
  end if;

  select coalesce(jsonb_agg(w.metadata || jsonb_build_object(
    'id', w.list_id,
    'symbols', coalesce((select jsonb_agg(i.symbol order by i.position)
      from public.watchlist_items i where i.owner_id = w.owner_id and i.list_id = w.list_id), '[]'::jsonb)
  ) order by w.position), '[]'::jsonb) into v_lists
  from public.watchlists w where w.owner_id = p_owner_id;

  select coalesce(jsonb_agg(o.payload || jsonb_build_object('id', o.order_id) order by o.position), '[]'::jsonb)
  into v_orders from public.paper_orders o where o.owner_id = p_owner_id;
  select coalesce(jsonb_agg(c.state || jsonb_build_object('id', c.cycle_id) order by c.position), '[]'::jsonb)
  into v_cycles from public.investment_cycles c where c.owner_id = p_owner_id;
  select risk_free_rate into v_rate from public.terminal_preferences where owner_id = p_owner_id;
  select count(*) into v_pending from public.analysis_outbox where owner_id = p_owner_id and delivered_at is null;
  return jsonb_build_object('revision', v_profile.revision, 'state', jsonb_build_object(
    'lists', v_lists, 'orders', v_orders, 'cycles', v_cycles, 'rate', v_rate
  ), 'pendingArchives', v_pending);
end;
$$;

create function public.save_terminal_state(
  p_owner_id text,
  p_display_name text,
  p_email text,
  p_expected_revision bigint,
  p_state jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revision bigint;
  v_list jsonb;
begin
  if p_owner_id is null or length(btrim(p_owner_id)) not between 1 and 255
    or p_display_name is null or length(p_display_name) > 255
    or p_email is null or length(p_email) > 320
    or p_expected_revision is null or p_expected_revision < 0 or p_expected_revision >= 9007199254740991 then
    raise exception using errcode = '22023', message = 'Invalid owner or expected revision.';
  end if;
  if jsonb_typeof(p_state) is distinct from 'object'
    or jsonb_typeof(p_state -> 'lists') is distinct from 'array'
    or jsonb_typeof(p_state -> 'orders') is distinct from 'array'
    or jsonb_typeof(p_state -> 'cycles') is distinct from 'array'
    or jsonb_typeof(p_state -> 'rate') is distinct from 'number' then
    raise exception using errcode = '22023', message = 'Invalid terminal state.';
  end if;
  -- Reserve 8 KiB of the 2 MiB bridge request limit for the archive envelope.
  -- Measure PostgreSQL's canonical JSON text, including UTF-8 multibyte data.
  if octet_length(p_state::text) > 2088960
    or (p_state ->> 'rate')::numeric not between 0 and 0.25
    or jsonb_array_length(p_state -> 'lists') > 200
    or jsonb_array_length(p_state -> 'orders') > 5000
    or jsonb_array_length(p_state -> 'cycles') > 200 then
    raise exception using errcode = '22023', message = 'Terminal state exceeds its limits.';
  end if;
  for v_list in select value from jsonb_array_elements(p_state -> 'lists') loop
    if jsonb_typeof(v_list) is distinct from 'object'
      or jsonb_typeof(v_list -> 'id') is distinct from 'string'
      or jsonb_typeof(v_list -> 'symbols') is distinct from 'array' then
      raise exception using errcode = '22023', message = 'Invalid watchlist.';
    end if;
    if jsonb_array_length(v_list -> 'symbols') not between 1 and 1000
      or exists (select 1 from jsonb_array_elements(v_list -> 'symbols') s where jsonb_typeof(s.value) <> 'string') then
      raise exception using errcode = '22023', message = 'Invalid watchlist symbols.';
    end if;
  end loop;
  if exists (select 1 from jsonb_array_elements((p_state -> 'orders') || (p_state -> 'cycles')) item
    where jsonb_typeof(item.value) is distinct from 'object'
      or jsonb_typeof(item.value -> 'id') is distinct from 'string') then
    raise exception using errcode = '22023', message = 'Invalid order or cycle ID.';
  end if;

  insert into public.terminal_profiles(owner_id, display_name, email)
  values (p_owner_id, p_display_name, p_email) on conflict (owner_id) do nothing;
  -- A row lock serializes writes, including two simultaneous first saves.
  select revision into v_revision from public.terminal_profiles where owner_id = p_owner_id for update;
  if v_revision <> p_expected_revision then
    raise exception using errcode = 'PT409', message = 'The terminal state has changed. Reload before saving.';
  end if;

  insert into public.terminal_preferences(owner_id, risk_free_rate)
  values (p_owner_id, (p_state ->> 'rate')::numeric)
  on conflict (owner_id) do update set risk_free_rate = excluded.risk_free_rate;

  delete from public.watchlists where owner_id = p_owner_id;
  delete from public.paper_orders where owner_id = p_owner_id;
  delete from public.investment_cycles where owner_id = p_owner_id;

  insert into public.watchlists(owner_id, list_id, position, metadata)
  select p_owner_id, w.value ->> 'id', (w.ordinality - 1)::integer, w.value - 'id' - 'symbols'
  from jsonb_array_elements(p_state -> 'lists') with ordinality w(value, ordinality);
  insert into public.watchlist_items(owner_id, list_id, position, symbol)
  select p_owner_id, w.value ->> 'id', (s.ordinality - 1)::integer, s.value #>> '{}'
  from jsonb_array_elements(p_state -> 'lists') w(value)
  cross join lateral jsonb_array_elements(w.value -> 'symbols') with ordinality s(value, ordinality);
  insert into public.paper_orders(owner_id, order_id, position, payload)
  select p_owner_id, o.value ->> 'id', (o.ordinality - 1)::integer, o.value - 'id'
  from jsonb_array_elements(p_state -> 'orders') with ordinality o(value, ordinality);
  insert into public.investment_cycles(owner_id, cycle_id, position, state)
  select p_owner_id, c.value ->> 'id', (c.ordinality - 1)::integer, c.value - 'id'
  from jsonb_array_elements(p_state -> 'cycles') with ordinality c(value, ordinality);

  v_revision := v_revision + 1;
  update public.terminal_profiles set revision = v_revision, initialized = true,
    display_name = p_display_name, email = p_email, updated_at = now() where owner_id = p_owner_id;
  -- Always enqueue, even while MongoDB is disabled: later activation can drain
  -- committed revisions without losing the original snapshot.
  insert into public.analysis_outbox(owner_id, revision, payload) values (p_owner_id, v_revision, p_state);
  return jsonb_build_object('revision', v_revision);
end;
$$;

create function public.list_analysis_outbox(p_owner_id text, p_limit integer default 10)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_entries jsonb;
begin
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception using errcode = '22023', message = 'Invalid outbox limit.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', o.snapshot_id, 'ownerId', o.owner_id,
    'revision', o.revision, 'state', o.payload, 'createdAt', o.created_at) order by o.revision), '[]'::jsonb)
  into v_entries from (select * from public.analysis_outbox where owner_id = p_owner_id
    and delivered_at is null order by revision limit p_limit) o;
  return v_entries;
end;
$$;

create function public.mark_analysis_delivered(p_owner_id text, p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(array_length(p_ids, 1), 0) > 100 then
    raise exception using errcode = '22023', message = 'Too many outbox IDs.';
  end if;
  update public.analysis_outbox set delivered_at = now()
  where owner_id = p_owner_id and snapshot_id = any(p_ids) and delivered_at is null;
end;
$$;

revoke all on function public.load_terminal_state(text) from public, anon, authenticated;
revoke all on function public.save_terminal_state(text, text, text, bigint, jsonb) from public, anon, authenticated;
revoke all on function public.list_analysis_outbox(text, integer) from public, anon, authenticated;
revoke all on function public.mark_analysis_delivered(text, uuid[]) from public, anon, authenticated;
grant usage on schema public to service_role;
grant execute on function public.load_terminal_state(text) to service_role;
grant execute on function public.save_terminal_state(text, text, text, bigint, jsonb) to service_role;
grant execute on function public.list_analysis_outbox(text, integer) to service_role;
grant execute on function public.mark_analysis_delivered(text, uuid[]) to service_role;
