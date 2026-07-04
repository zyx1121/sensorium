import type { SpanNode, SpanRow } from "./rows.js";

/**
 * Builds a span tree from a flat list of spans belonging to a single trace.
 * Spans whose parent isn't present in the input (root span, or partial fetch)
 * become tree roots. Pure function — no DB access, easy to unit test.
 */
export function buildSpanTree(spans: SpanRow[]): SpanNode[] {
  const nodes = new Map<string, SpanNode>();
  for (const span of spans) {
    nodes.set(span.spanId, { ...span, children: [] });
  }

  const roots: SpanNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentSpanId ? nodes.get(node.parentSpanId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const byStart = (a: SpanNode, b: SpanNode) => a.startTs.getTime() - b.startTs.getTime();
  const sortRec = (list: SpanNode[]) => {
    list.sort(byStart);
    for (const n of list) sortRec(n.children);
  };
  sortRec(roots);

  return roots;
}
