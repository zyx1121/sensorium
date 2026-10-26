import { describe, expect, test } from "bun:test";
import { parseMetricDrop } from "../src/metric-drop.js";

describe("parseMetricDrop", () => {
  test("drops nothing when unset or empty", () => {
    expect(parseMetricDrop(undefined)("proxmox_vm_cpu")).toBe(false);
    expect(parseMetricDrop(" , ")("proxmox_vm_cpu")).toBe(false);
  });

  test("matches whole names with * as a wildcard", () => {
    const drop = parseMetricDrop("proxmox_vm_*, system.paging.*");
    expect(drop("proxmox_vm_blockstat_rd_bytes")).toBe(true);
    expect(drop("system.paging.usage")).toBe(true);
    expect(drop("proxmox_node_cpustat_cpu")).toBe(false);
    expect(drop("x_proxmox_vm_cpu")).toBe(false);
  });

  test("treats regex characters literally", () => {
    const drop = parseMetricDrop("hw.gpu");
    expect(drop("hw.gpu")).toBe(true);
    expect(drop("hwXgpu")).toBe(false);
  });
});
