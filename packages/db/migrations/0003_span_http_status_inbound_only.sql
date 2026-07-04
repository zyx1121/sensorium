-- http_status_code was being populated for every span carrying an
-- http.response.status_code/http.status_code-shaped attribute, including OUTBOUND
-- client spans — e.g. this service's own instrumented `fetch()` to Supabase
-- (http.client.name = 'fetch', operation.name = 'fetch.GET', kind = CLIENT). That
-- polluted error_summary's errorSpanCount and top_sources' per-IP error counts with
-- the *callee's* status, not an inbound request this service actually served.
--
-- packages/core's mapper (mapOtlpTracesToRows) no longer fills http_status_code for
-- these going forward — see isInboundSpan()/isOutboundSpan(). This backfills the
-- same rule onto rows ingested before the fix. Non-destructive: the raw attribute
-- is untouched in `attributes`, only the promoted column is cleared.
update spans
set http_status_code = null
where http_status_code is not null
  and (
    attributes ? 'http.client.name'
    or (attributes ->> 'operation.name') ilike 'fetch%'
    or kind = 'client'
  );
