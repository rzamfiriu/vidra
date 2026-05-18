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

// Convert OS-native path separators to forward slashes so the resulting
// string is safe to embed verbatim in JSON, XML, and YAML. On Windows the
// native separator is `\`, which JSON parsers interpret as the start of an
// escape sequence (`\a`, `\u`, ...). npm, NuGet, and the .NET tooling all
// accept forward slashes on Windows, so this is a lossless transformation
// for path values that will end up inside text-templated files.
export const toTextPath = (p: string): string => p.replaceAll("\\", "/");

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
