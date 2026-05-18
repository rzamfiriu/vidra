export interface ParsedArgs {
  _: string[];
  [key: string]: string | boolean | string[];
}

export const toPascalCase = (str: string): string => {
  return str
    .replace(/[-_]+(.)?/g, (_, c: string | undefined) =>
      c ? c.toUpperCase() : "",
    )
    .replace(/^(.)/, (_, c: string) => c.toUpperCase());
};

export const toKebabCase = (str: string): string => {
  return str
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();
};

export const toTitleCase = (str: string): string => {
  return str
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
};

export const parseArgs = (argv: string[]): ParsedArgs => {
  const args: ParsedArgs = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const [key, val] = arg.slice(2).split("=");
      args[key] = val ?? argv[++i] ?? true;
    } else {
      (args._ as string[]).push(arg);
    }
  }
  return args;
};
