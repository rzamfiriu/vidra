import { buildCommand } from "./commands/build.js";
import { keygenCommand } from "./commands/keygen.js";
import { updatesCommand } from "./commands/updates.js";
import { verifyCommand } from "./commands/verify.js";
import { devCommand, runCommand } from "./commands/dev.js";
import { runDoctor } from "./doctor.js";
import { ALL, BUILD, DEV, DOCTOR, KEYGEN, RUN, UPDATES, VERIFY } from "./commands/specs.js";
import { renderCommandHelp, renderIndex, type CommandSpec } from "./help.js";
import { dim, row } from "@vidra-dev/cli-shared/theme";
import { CLI_VERSION } from "./cli-version.js";

type Handler = (argv: string[]) => Promise<void> | void;

const COMMANDS: Record<string, { spec: CommandSpec; run: Handler }> = {
  dev: { spec: DEV, run: devCommand },
  run: { spec: RUN, run: runCommand },
  build: { spec: BUILD, run: buildCommand },
  updates: { spec: UPDATES, run: updatesCommand },
  keygen: { spec: KEYGEN, run: keygenCommand },
  verify: { spec: VERIFY, run: verifyCommand },
  doctor: {
    spec: DOCTOR,
    run: async (argv) => {
      process.exit(await runDoctor(argv));
    },
  },
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const name = args[0];

  if (name === undefined || name === "help" || name === "--help" || name === "-h") {
    // `vidra help build` is the same question as `vidra build --help`.
    const topic = args[1] ? COMMANDS[args[1]] : undefined;
    console.log(topic ? renderCommandHelp(topic.spec) : renderIndex(ALL));
    return;
  }

  if (name === "--version" || name === "-v") {
    console.log(CLI_VERSION);
    return;
  }

  const command = COMMANDS[name];
  if (!command) {
    console.error(row({ glyph: "error", detail: dim(`unknown command: ${name}`) }));
    console.log(renderIndex(ALL));
    process.exit(1);
  }

  const rest = args.slice(1);
  if (rest.includes("--help") || rest.includes("-h")) {
    console.log(renderCommandHelp(command.spec));
    return;
  }

  await command.run(rest);
};

main().catch((e: Error) => {
  console.error(row({ glyph: "error", detail: dim(e.message) }));
  process.exit(1);
});
