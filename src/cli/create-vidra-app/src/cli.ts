import chalk from "chalk";
import { buildCommand } from "./commands/build.js";
import { devCommand, runCommand } from "./commands/dev.js";
import { runDoctor } from "./doctor.js";

const VERSION = "0.1.5";

const printHelp = (): void => {
  console.log(`
  ${chalk.bold("vidra")} ${chalk.dim(`v${VERSION}`)}

  ${chalk.dim("Usage:")}
    vidra <command> [options]

  ${chalk.dim("Commands:")}
    dev     Start the development environment (Vite + native host)
    run     Build and launch the native host only (no Vite dev server)
    build   Build and package the application for distribution
    doctor  Check that your environment is set up to build Vidra apps
    help    Show this help message

  ${chalk.dim("Examples:")}
    vidra dev                   ${chalk.dim("# start Vite + native host")}
    vidra dev --target windows  ${chalk.dim("# run the Windows host")}
    vidra run                   ${chalk.dim("# launch the host (UI served separately)")}
    vidra build                 ${chalk.dim("# auto-detect platform")}
    vidra build --target macos  ${chalk.dim("# macOS DMG")}
    vidra build --verbose       ${chalk.dim("# show full build output")}
    vidra doctor                ${chalk.dim("# verify .NET SDK + MAUI workload")}
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
      console.log(VERSION);
      break;
    default:
      console.error(chalk.red(`  Unknown command: ${command}\n`));
      printHelp();
      process.exit(1);
  }
};

main().catch((e: Error) => {
  console.error(chalk.red(e.message));
  process.exit(1);
});
