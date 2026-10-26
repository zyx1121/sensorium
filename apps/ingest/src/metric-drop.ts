/**
 * Builds the predicate for SENSORIUM_METRIC_DROP: a comma-separated list of
 * metric-name patterns whose points ingest discards before they reach the
 * database. `*` matches any run of characters; nothing else is special.
 * An empty or unset list drops nothing.
 */
export function parseMetricDrop(spec: string | undefined): (metricName: string) => boolean {
  const patterns = (spec ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => new RegExp(`^${p.split("*").map(escape).join(".*")}$`));
  if (patterns.length === 0) return () => false;
  return (metricName) => patterns.some((re) => re.test(metricName));
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
