import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";

const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "public/uploads",
  "understanding",
]);

const ENV_ALLOWLIST = new Set([
  "server.js",
  "utils/config.js",
  "utils/session.js",
  "scripts/lint.js",
]);

const staticRules = [
  {
    id: "no-debugger",
    pattern: /^\s*debugger\s*;?\s*$/m,
    message: "leftover debugger statement",
  },
  {
    id: "no-focused-tests",
    pattern: /\b(?:describe|it|test)\.only\s*\(/,
    message: "focused test would silently skip the rest of the suite",
  },
  {
    id: "no-hardcoded-database-uri",
    pattern: /mongodb(?:\+srv)?:\/\/[^\s'"`]+/,
    message: "hard-coded MongoDB URI; read it from configuration instead",
    exempt: (file) => file.startsWith("test/"),
  },
];

const isJavaScript = (file) => file.endsWith(".js");
const isEnvExempt = (file) =>
  file.startsWith("test/") || ENV_ALLOWLIST.has(file);

const collectJavaScriptFiles = () => {
  const files = execFileSync("git", ["ls-files"], { encoding: "utf8" });
  return files
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (file) =>
        file &&
        isJavaScript(file) &&
        ![...IGNORED_DIRECTORIES].some((directory) => file.startsWith(`${directory}/`)),
    );
};

const checkSyntax = (file) => {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    return null;
  } catch (error) {
    const output = `${error.stderr || ""}${error.stdout || ""}`.trim();
    return output || "syntax error";
  }
};

const checkSource = (file, source) => {
  const problems = [];
  for (const rule of staticRules) {
    if (rule.exempt?.(file)) {
      continue;
    }
    const match = source.match(rule.pattern);
    if (match) {
      const line = source.slice(0, match.index).split("\n").length;
      problems.push(`${file}:${line} [${rule.id}] ${rule.message}`);
    }
  }
  if (source.includes("process.env") && !isEnvExempt(file)) {
    const line = source.slice(0, source.indexOf("process.env")).split("\n").length;
    problems.push(
      `${file}:${line} [env-via-config] read environment variables through utils/config.js`,
    );
  }
  return problems;
};

const files = collectJavaScriptFiles();
const problems = [];

for (const file of files) {
  const source = readFileSync(file, "utf8");
  const syntaxError = checkSyntax(file);
  if (syntaxError) {
    problems.push(`${file} [syntax] ${syntaxError.split("\n")[0]}`);
    continue;
  }
  problems.push(...checkSource(file, source));
}

if (problems.length > 0) {
  console.error("Static checks failed:\n");
  for (const problem of problems) {
    console.error(`  ${problem}`);
  }
  console.error(`\n${problems.length} problem(s) in ${files.length} checked files.`);
  process.exit(1);
}

console.log(`Static checks passed (${files.length} JavaScript files).`);
