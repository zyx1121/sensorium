-- sensorium v0 schema. One Postgres, three signals, all scoped by `project`
-- (= OTel `service.namespace`, resolved from the ingest bearer token — never
-- trusted from the request body).

create table if not exists projects (
  name text primary key,
  ingest_token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);

create table if not exists logs (
  id bigint generated always as identity primary key,
  project text not null references projects (name),
  ts timestamptz not null,
  severity text,
  body text,
  trace_id text,
  span_id text,
  resource jsonb not null default '{}',
  attributes jsonb not null default '{}'
);

create index if not exists logs_project_ts_idx on logs (project, ts desc);
create index if not exists logs_project_trace_idx on logs (project, trace_id);
create index if not exists logs_attributes_gin_idx on logs using gin (attributes);

create table if not exists spans (
  project text not null references projects (name),
  trace_id text not null,
  span_id text not null,
  parent_span_id text,
  name text not null,
  kind text not null check (
    kind in ('unspecified', 'internal', 'server', 'client', 'producer', 'consumer')
  ),
  start_ts timestamptz not null,
  end_ts timestamptz not null,
  duration_ms double precision not null,
  status_code text,
  resource jsonb not null default '{}',
  attributes jsonb not null default '{}',
  primary key (project, trace_id, span_id)
);

create index if not exists spans_project_trace_idx on spans (project, trace_id);
create index if not exists spans_project_start_idx on spans (project, start_ts desc);

create table if not exists metric_points (
  id bigint generated always as identity primary key,
  project text not null references projects (name),
  metric_name text not null,
  ts timestamptz not null,
  kind text not null check (kind in ('gauge', 'sum', 'histogram')),
  value double precision not null,
  attributes jsonb not null default '{}',
  resource jsonb not null default '{}'
);

create index if not exists metric_points_project_name_ts_idx on metric_points (project, metric_name, ts desc);
