-- Readers that follow every project's spans in arrival order (golem polls
-- `where start_ts > $1 order by start_ts` once a second) had only
-- spans_project_start_idx (project, start_ts desc) to use, so each poll walked
-- the whole index: 33,598 buffers and 109 ms on a 5.5M-row table. With this
-- index the same query reads 27 buffers in 0.1 ms.
--
-- On a large live table, build it first without blocking writes:
--   create index concurrently if not exists spans_start_idx on spans (start_ts);
-- This statement is then a no-op.
create index if not exists spans_start_idx on spans (start_ts);
