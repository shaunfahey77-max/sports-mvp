create extension if not exists pgcrypto;

-- =========================
-- MARKET SNAPSHOTS
-- =========================
create table if not exists market_snapshots (
  id uuid primary key default gen_random_uuid(),

  event_id text not null,
  league text not null,
  game_date date not null,
  commence_time timestamptz not null,

  home_team text not null,
  home_abbr text not null,
  away_team text not null,
  away_abbr text not null,

  bookmaker text not null,
  market_type text not null check (market_type in ('moneyline','spread','total')),
  side text not null check (side in ('home','away','over','under')),
  line numeric null,
  odds_american integer not null,
  odds_decimal numeric not null,

  snapshot_time timestamptz not null,
  snapshot_kind text not null check (snapshot_kind in ('publish','close','intraday')),
  source text not null,

  raw_implied_prob numeric,
  no_vig_prob numeric,
  hold_pct numeric,

  is_consensus boolean not null default false,
  is_stale boolean not null default false,

  created_at timestamptz default now()
);

create index if not exists ix_market_event on market_snapshots(event_id);
create index if not exists ix_market_league_date on market_snapshots(league, game_date);

-- =========================
-- PREDICTIONS
-- =========================
create table if not exists predictions (
  id uuid primary key default gen_random_uuid(),

  event_id text not null,
  league text not null,
  game_date date not null,
  commence_time timestamptz not null,

  home_team text not null,
  home_abbr text not null,
  away_team text not null,
  away_abbr text not null,

  model_version text not null,
  feature_version text not null,
  generated_at timestamptz not null,

  p_home numeric not null,
  p_away numeric not null,

  fair_ml_home integer,
  fair_ml_away integer,

  fair_spread_home numeric,
  fair_spread_away numeric,
  fair_total numeric,

  confidence_score numeric,
  uncertainty_score numeric,
  data_quality_score numeric,

  created_at timestamptz default now()
);

create index if not exists ix_predictions_event on predictions(event_id);
create index if not exists ix_predictions_league_date on predictions(league, game_date);

-- =========================
-- RECOMMENDED PICKS
-- =========================
create table if not exists recommended_picks (
  id uuid primary key default gen_random_uuid(),

  prediction_id uuid references predictions(id),

  event_id text not null,
  league text not null,
  game_date date not null,
  commence_time timestamptz not null,

  model_version text not null,
  selection_version text not null,
  published_at timestamptz not null,

  market_type text not null check (market_type in ('moneyline','spread','total')),
  pick_side text not null check (pick_side in ('home','away','over','under','pass')),
  pick_line numeric,

  publish_odds_american integer,
  publish_odds_decimal numeric,

  publish_snapshot_id uuid references market_snapshots(id),

  edge_pct numeric,
  ev_per_100 numeric,
  kelly_half numeric,
  selection_score numeric,

  tier text not null check (tier in ('ELITE','STRONG','ACTIONABLE','PASS')),
  status text not null check (status in ('published','skipped','voided')),

  created_at timestamptz default now()
);

create index if not exists ix_picks_event on recommended_picks(event_id);
create index if not exists ix_picks_league_date on recommended_picks(league, game_date);

-- =========================
-- PICK RESULTS
-- =========================
create table if not exists pick_results (
  id uuid primary key default gen_random_uuid(),

  pick_id uuid references recommended_picks(id),

  event_id text not null,
  league text not null,
  game_date date not null,

  score_version text not null,
  scored_at timestamptz not null,

  final_home_score integer,
  final_away_score integer,

  result text not null check (result in ('WIN','LOSS','PUSH','PASS','VOID')),

  units_risked numeric default 1,
  units_won numeric,
  roi_pct numeric,

  publish_odds_american integer,
  close_odds_american integer,

  publish_line numeric,
  close_line numeric,

  clv_implied_delta numeric,
  clv_line_delta numeric,

  xroi_publish numeric,
  xroi_close numeric,

  created_at timestamptz default now()
);

create index if not exists ix_results_event on pick_results(event_id);
create index if not exists ix_results_league_date on pick_results(league, game_date);

-- =========================
-- PERFORMANCE VIEWS
-- =========================
create or replace view performance_daily_v2 as
select
  league,
  game_date as date,
  count(*) filter (where result in ('WIN','LOSS','PUSH')) as picks,
  count(*) filter (where result='WIN') as wins,
  count(*) filter (where result='LOSS') as losses,
  sum(units_won) as units,
  avg(clv_line_delta) as avg_clv_line,
  avg(xroi_publish) as avg_xroi
from pick_results
group by league, game_date;

create or replace view performance_by_market_v2 as
select
  rp.league,
  rp.market_type,
  count(*) as picks,
  sum(pr.units_won) as units
from pick_results pr
join recommended_picks rp on rp.id = pr.pick_id
group by rp.league, rp.market_type;

create or replace view performance_by_tier_v2 as
select
  rp.league,
  rp.tier,
  count(*) as picks,
  sum(pr.units_won) as units
from pick_results pr
join recommended_picks rp on rp.id = pr.pick_id
group by rp.league, rp.tier;

