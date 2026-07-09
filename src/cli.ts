#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { isAbsolute, resolve } from "node:path";
import * as Diagnostics from "./Diagnostics.js";

interface DoctorCliOptions {
  readonly modulePath: string;
  readonly exports: readonly string[];
  readonly json: boolean;
  readonly failOnWarnings: boolean;
}

function usage(): string {
  return [
    "Usage:",
    "  af-ui doctor <module> [--export name] [--json] [--fail-on-warnings]",
    "  af-ui-doctor <module> [--export name] [--json] [--fail-on-warnings]",
    "",
    "The module may export route trees, server route arrays, diagnostics arrays,",
    "or objects with a diagnostics array.",
  ].join("\n");
}

function parseDoctorArgs(args: readonly string[]): DoctorCliOptions | { readonly help: true } {
  const rest = args[0] === "doctor" ? args.slice(1) : args;
  const exports: string[] = [];
  let modulePath: string | undefined;
  let json = false;
  let failOnWarnings = false;

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    if (arg === "--help" || arg === "-h") return { help: true };
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--fail-on-warnings") {
      failOnWarnings = true;
      continue;
    }
    if (arg === "--export") {
      const name = rest[index + 1];
      if (name === undefined || name.startsWith("-")) {
        throw new Error("--export requires a following export name.");
      }
      exports.push(name);
      index += 1;
      continue;
    }
    if (arg.startsWith("--export=")) {
      exports.push(arg.slice("--export=".length));
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option '${arg}'.`);
    }
    if (modulePath !== undefined) {
      throw new Error(`Unexpected argument '${arg}'.`);
    }
    modulePath = arg;
  }

  if (modulePath === undefined) {
    throw new Error("Missing module path.");
  }
  return { modulePath, exports, json, failOnWarnings };
}

function moduleSpecifier(modulePath: string): string {
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(modulePath)) return modulePath;
  if (modulePath.startsWith(".") || modulePath.startsWith("/") || isAbsolute(modulePath)) {
    return pathToFileURL(resolve(modulePath)).href;
  }
  return modulePath;
}

function formatTargets(targets: readonly Diagnostics.DoctorTarget[], report: Diagnostics.DoctorReport): string {
  if (targets.length === 0) return "No diagnostic targets found.";
  const lines = [
    `AF-UI doctor: ${report.errorCount} error(s), ${report.warningCount} warning(s), ${report.infoCount} info.`,
  ];
  for (const target of targets) {
    lines.push(`\n${target.name}:`);
    if (target.diagnostics.length === 0) {
      lines.push("  No diagnostics.");
      continue;
    }
    for (const diagnostic of target.diagnostics) {
      lines.push(`  ${Diagnostics.format(diagnostic)}`);
    }
  }
  return lines.join("\n");
}

async function runDoctor(options: DoctorCliOptions): Promise<number> {
  const loaded = await import(moduleSpecifier(options.modulePath)) as Record<string, unknown>;
  const targets = Diagnostics.collectDoctorTargets(loaded, {
    exports: options.exports.length === 0 ? undefined : options.exports,
  });
  const report = Diagnostics.doctorFromTargets(targets);

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ ...report, targets }, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatTargets(targets, report)}\n`);
  }

  return report.errorCount > 0 || (options.failOnWarnings && report.warningCount > 0) ? 1 : 0;
}

export async function main(args: readonly string[] = process.argv.slice(2)): Promise<number> {
  try {
    const parsed = parseDoctorArgs(args);
    if ("help" in parsed) {
      process.stdout.write(`${usage()}\n`);
      return 0;
    }
    return await runDoctor(parsed);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${usage()}\n`);
    return 2;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const code = await main();
  process.exitCode = code;
}
