-- =========================================================
-- Phase 2 Premium: Odds snapshots table
-- Purpose: persist the recommended bet's odds/line at prediction time
-- so ROI grading does not require paid historical odds from Odds API.
-- =========================================================

create table if not exists public.odds_snapshots (
  id bigserial primary key,
  league text not null,
  date date not null,
  game_id text not null,
  home_abbr text,
  away_abbr text,
  market_type text not null,
  side text not null,
  line numeric,
  odds_american integer,
  model_prob numeric,
  implied_prob numeric,
  edge numeric,
  ev_100 numeric,
  kelly_half numeric,
  tier text,
  is_model_only boolean default false,
  bookmaker text,
  snap_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists odds_snapshots_uniq
  on public.odds_snapshots (league, date, game_id, market_type);

-- optional for querying by date/league
create index if not exists odds_snapshots_date_league_idx
  on public.odds_snapshots (date, league);
