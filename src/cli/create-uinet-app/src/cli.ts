import chalk from "chalk";
import { buildCommand } from "./commands/build.js";
import { devCommand } from "./commands/dev.js";

const VERSION = "0.1.0";

const printHelp = (): void => {
  console.log(`
  ${chalk.bold("uinet")} ${chalk.dim(`v${VERSION}`)}

  ${chalk.dim("Usage:")}
    uinet <command> [options]

  ${chalk.dim("Commands:")}
    dev     Start the development environment
    build   Build and package the application for distribution
    help    Show this help message

  ${chalk.dim("Examples:")}
    uinet dev                   ${chalk.dim("# start Vite + native host")}
    uinet dev --target windows  ${chalk.dim("# run the Windows host")}
    uinet build                 ${chalk.dim("# auto-detect platform")}
    uinet build --target macos  ${chalk.dim("# macOS DMG")}
    uinet build --verbose       ${chalk.dim("# show full build output")}
`);
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case "dev":
      await devCommand(args.slice(1));
      break;
    case "build":
      await buildCommand(args.slice(1));
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
