-- Partition metric_points by UTC day, and drop the id column nothing reads.
--
-- metric_points is the only table with real volume: the `pve` project alone
-- writes ~6.9M rows/day (~2.4GB), and with no expiry at all a 20G disk filled
-- in seven days and put Postgres into a checkpoint-PANIC crash loop. Range
-- partitioning on ts makes expiry a DROP TABLE, which hands space straight
-- back to the OS — a DELETE would leave the same bytes behind as bloat and
-- lean on autovacuum to maybe reuse them later.
--
-- `id` goes at the same time. No query in the codebase ever selected it and
-- the insert path names its columns explicitly, but its primary-key index
-- still cost 959MB of a 2.7GB index footprint. A partitioned table would also
-- have forced it into a composite (ts, id) key to include the partition key,
-- which buys nothing when the column is unused.
--
-- Partitions covering existing data are created up front; from then on
-- `bun run db:retention` (systemd timer, see deploy/) rolls them forward and
-- drops expired ones. metric_points_default is a backstop so a missing
-- partition degrades into "rows land somewhere" rather than ingest 500s.

alter table metric_points rename to metric_points_legacy;
alter index metric_points_pkey rename to metric_points_legacy_pkey;
alter index metric_points_project_name_ts_idx rename to metric_points_legacy_project_name_ts_idx;

create table metric_points (
  project text not null references projects (name),
  metric_name text not null,
  ts timestamptz not null,
  kind text not null check (kind in ('gauge', 'sum', 'histogram')),
  value double precision not null,
  attributes jsonb not null default '{}',
  resource jsonb not null default '{}'
) partition by range (ts);

-- Bounds are UTC midnights, matching partitionBounds() in src/retention.ts.
-- Anything else would make partition names disagree with their contents once
-- the server timezone and UTC diverge.
do $$
declare
  day date;
  last_day date;
begin
  select coalesce(min(ts at time zone 'UTC')::date, current_date),
         coalesce(max(ts at time zone 'UTC')::date, current_date)
    into day, last_day
    from metric_points_legacy;

  -- Reach past today so ingest keeps landing in real partitions even if the
  -- retention timer is not installed until later.
  last_day := greatest(last_day, (now() at time zone 'UTC')::date) + 7;

  while day <= last_day loop
    execute format(
      'create table %I partition of metric_points for values from (%L) to (%L)',
      'metric_points_' || to_char(day, 'YYYYMMDD'),
      (day::timestamp at time zone 'UTC'),
      ((day + 1)::timestamp at time zone 'UTC')
    );
    day := day + 1;
  end loop;
end $$;

create table metric_points_default partition of metric_points default;

insert into metric_points (project, metric_name, ts, kind, value, attributes, resource)
select project, metric_name, ts, kind, value, attributes, resource
from metric_points_legacy;

drop table metric_points_legacy;

-- Built after the copy: indexing 44M rows once beats maintaining the index
-- through every inserted row. Declaring it on the parent cascades to every
-- current and future partition.
create index metric_points_project_name_ts_idx on metric_points (project, metric_name, ts desc);
