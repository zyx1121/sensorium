// A project name is typed on a command line, so an option such as --help must
// never become a name. Names match what producers already use, for example
// "www.zyx.tw" or "agent-oai".
const NAME = /^[a-z0-9][a-z0-9._-]{0,62}$/;

export const REGISTER_USAGE = [
  "usage: register-project <name>",
  "  name: lowercase letters, digits, '.', '_' or '-'; starts with a letter or digit; up to 63 characters",
  "  An existing name gets a new token and the old token stops working.",
].join("\n");

export type RegisterArgs =
  | { kind: "help" }
  | { kind: "register"; name: string }
  | { kind: "error"; message: string };

export function parseRegisterArgs(args: string[]): RegisterArgs {
  if (args.some((a) => a === "-h" || a === "--help")) return { kind: "help" };
  const flag = args.find((a) => a.startsWith("-"));
  if (flag) return { kind: "error", message: `unknown option: ${flag}` };
  const [name] = args;
  if (args.length !== 1 || name === undefined) return { kind: "error", message: "expected exactly one project name" };
  if (!NAME.test(name)) return { kind: "error", message: `invalid project name: ${name}` };
  return { kind: "register", name };
}
