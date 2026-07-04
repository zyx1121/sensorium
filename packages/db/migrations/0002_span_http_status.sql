-- Promotes the span's HTTP response status out of `attributes` JSONB into its own
-- column, same treatment `kind`/`status_code` already got. Lets error_summary widen
-- its error-span rule to "OTLP ERROR status OR HTTP >= 400" (attack visibility needs
-- 401/429/404 to show up) without unpacking JSONB per row.

alter table spans add column if not exists http_status_code integer;

-- Backfill from whatever's already in `attributes` for rows ingested before this
-- migration — current stable semconv key first, falling back to the legacy one.
-- Guarded with a digits-only regex so a malformed/non-numeric attribute value can't
-- abort the whole migration transaction on a bad ::integer cast.
update spans
set http_status_code = coalesce(
  case when attributes ->> 'http.response.status_code' ~ '^[0-9]+$'
    then (attributes ->> 'http.response.status_code')::integer end,
  case when attributes ->> 'http.status_code' ~ '^[0-9]+$'
    then (attributes ->> 'http.status_code')::integer end
)
where http_status_code is null;

create index if not exists spans_project_http_status_idx
  on spans (project, http_status_code)
  where http_status_code is not null;
