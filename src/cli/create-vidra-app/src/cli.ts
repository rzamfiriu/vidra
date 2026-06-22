import { buildCommand } from "./commands/build.js";
import { devCommand, runCommand } from "./commands/dev.js";
import { runDoctor } from "./doctor.js";
import { CLI_VERSION, dim, lime, row, value, wordmark } from "./theme.js";

const printHelp = (): void => {
  const cmd = (name: string, desc: string): string =>
    `    ${value(name.padEnd(10))} ${dim(desc)}`;
  const ex = (args: string, comment: string): string =>
    `    ${lime("vidra")} ${value(args.padEnd(22))} ${dim(`# ${comment}`)}`;

  console.log(`
  ${wordmark()} ${dim(`v${CLI_VERSION}`)}

  ${dim("usage")}
    ${lime("vidra")} ${dim("<command> [options]")}

  ${dim("commands")}
${cmd("dev", "start vite + the native host (hot reload)")}
${cmd("run", "launch the native host only")}
${cmd("build", "build & package for distribution")}
${cmd("doctor", "check your environment")}
${cmd("help", "show this message")}

  ${dim("examples")}
${ex("dev --target windows", "run the windows host")}
${ex("build --plan", "preview the build, run nothing")}
${ex("build --target macos", "build & package a macOS DMG")}
${ex("doctor", "verify .NET SDK + MAUI workload")}
`);
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case "dev":
      await devCommand(args.slice(1));
      break;
    case "run":
      await runCommand(args.slice(1));
      break;
    case "build":
      await buildCommand(args.slice(1));
      break;
    case "doctor":
      process.exit(await runDoctor());
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printHelp();
      break;
    case "--version":
    case "-v":
      console.log(CLI_VERSION);
      break;
    default:
      console.error(row({ glyph: "error", detail: dim(`unknown command: ${command}`) }));
      printHelp();
      process.exit(1);
  }
};

main().catch((e: Error) => {
  console.error(row({ glyph: "error", detail: dim(e.message) }));
  process.exit(1);
});
