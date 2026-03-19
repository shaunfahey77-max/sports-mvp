create table if not exists pick_closes (
  id bigserial primary key,
  date date not null,
  league text not null,
  game_key text not null,
  market text not null,
  pick text not null,

  publish_book text,
  publish_line numeric,
  publish_odds integer,
  publish_captured_at timestamptz,
  publish_snapshot_key text,

  close_book text,
  close_line numeric,
  close_odds integer,
  close_captured_at timestamptz,
  close_snapshot_key text,

  close_method text,
  close_quality text,
  event_start timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint pick_closes_unique_key unique (date, league, game_key, market, pick)
);

create index if not exists idx_pick_closes_lookup
  on pick_closes (date, league, game_key, market, pick);

create index if not exists idx_pick_closes_date_league
  on pick_closes (date, league);

create index if not exists idx_pick_closes_close_quality
  on pick_closes (close_quality);

alter table picks_daily
  add column if not exists publish_captured_at timestamptz;

alter table picks_daily
  add column if not exists publish_snapshot_key text;

alter table picks_daily
  add column if not exists close_captured_at timestamptz;

alter table picks_daily
  add column if not exists close_snapshot_key text;

alter table picks_daily
  add column if not exists close_method text;

alter table picks_daily
  add column if not exists close_quality text;
