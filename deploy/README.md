# deploy

systemd units for a sensorium instance. Copy to `/etc/systemd/system/`, then
`systemctl daemon-reload`.

An instance is a checkout at `/opt/sensorium`, an env file at
`/etc/sensorium/app.env` (see `.env.example`), and a local Postgres. Two are
live: `sensorium-zyx` (LXC 205) and `sensorium-winlab` (LXC 202).

| Unit                          | What it does                        |
| ----------------------------- | ----------------------------------- |
| `sensorium-ingest.service`    | OTLP/HTTP receiver on `PORT` (8787) |
| `sensorium-mcp.service`       | MCP endpoint on `MCP_PORT` (8788)   |
| `sensorium-retention.timer`   | fires the sweep daily at 03:20 UTC  |
| `sensorium-retention.service` | the sweep itself (`Type=oneshot`)   |

```sh
systemctl enable --now sensorium-ingest sensorium-mcp
systemctl enable --now sensorium-retention.timer
```

## Retention

`metric_points` is partitioned by UTC day, so expiring metrics is a
`DROP TABLE` per day rather than a `DELETE` — the space returns to the
filesystem straight away. `spans` and `logs` are small enough that an ordinary
age-based `DELETE` is the right tool.

Windows are set per instance in `app.env`; the defaults are 14 days of metrics
and 30 days of spans and logs. Size the metric window against real throughput:
one busy PVE project alone writes roughly 2.4GB/day, so 14 days is about 33GB.

The timer is not optional. Without it, partitions stop being created (rows fall
into `metric_points_default`, which never expires) and nothing is ever dropped.
That is how a 20G disk filled in seven days on 2026-07-25 and put Postgres into
a checkpoint-PANIC crash loop, with `systemctl` still reporting both services
active the whole time.

Run it by hand any time — every step is idempotent:

```sh
cd /opt/sensorium && bun run db:retention
```

## Health check

Green units are not enough; the failure mode above kept both services active
while ingest silently dropped everything. Check the two things that actually
move:

```sh
df -h /
sudo -u postgres psql -d sensorium -Atc "select max(ts) from metric_points"
```
