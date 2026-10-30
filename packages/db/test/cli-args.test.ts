import { describe, expect, test } from "bun:test";
import { parseRegisterArgs } from "../src/cli-args.js";

describe("parseRegisterArgs", () => {
  test("a plain name registers", () => {
    expect(parseRegisterArgs(["www.zyx.tw"])).toEqual({ kind: "register", name: "www.zyx.tw" });
    expect(parseRegisterArgs(["agent-oai"])).toEqual({ kind: "register", name: "agent-oai" });
  });

  test("--help and -h print usage and never become a name", () => {
    expect(parseRegisterArgs(["--help"])).toEqual({ kind: "help" });
    expect(parseRegisterArgs(["-h"])).toEqual({ kind: "help" });
    expect(parseRegisterArgs(["my-service", "--help"])).toEqual({ kind: "help" });
  });

  test("any other option is an error", () => {
    expect(parseRegisterArgs(["--force"]).kind).toBe("error");
    expect(parseRegisterArgs(["-x", "name"]).kind).toBe("error");
  });

  test("no name, two names, or a bad name is an error", () => {
    expect(parseRegisterArgs([]).kind).toBe("error");
    expect(parseRegisterArgs(["a", "b"]).kind).toBe("error");
    for (const bad of ["", "Upper", "has space", ".dot", "a/b", "x".repeat(64)]) {
      expect(parseRegisterArgs([bad]).kind).toBe("error");
    }
  });
});
