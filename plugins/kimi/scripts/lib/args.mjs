import { parseArgs as nodeParseArgs } from "node:util";

const OPTIONS = {
  help: { type: "boolean", default: false, short: "h" },
  background: { type: "boolean", default: false, short: "b" },
  wait: { type: "boolean", default: false, short: "w" },
  base: { type: "string" },
  scope: { type: "string", default: "auto" },
  model: { type: "string" },
  "no-thinking": { type: "boolean", default: false },
  resume: { type: "boolean", default: false },
  fresh: { type: "boolean", default: false },
  json: { type: "boolean", default: false },
  "enable-review-gate": { type: "boolean", default: false },
  "disable-review-gate": { type: "boolean", default: false },
};

export function parseArgs(argv) {
  const { values, positionals } = nodeParseArgs({
    args: argv,
    options: OPTIONS,
    allowPositionals: true,
    strict: false,
  });

  const subcommand = positionals[0] || "help";
  const positionalArgs = positionals.slice(1);

  return { ...values, subcommand, positionalArgs, _: positionalArgs };
}
