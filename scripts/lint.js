import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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
  // Boots the app on a port of its own choosing, which it has to hand over
  // through the environment because that is the only way server.js is told.
  "scripts/walk-signup-flow.js",
  // Boots the app on a port of its own choosing, for the same reason.
  "scripts/probe-admin-pages.js",
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
  // `--others` as well as `--cached`: a file that has been written but not yet
  // staged is exactly the file most worth checking, and listing only tracked
  // files meant the check could report all-clear over a broken new file.
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard"],
    { encoding: "utf8" },
  );
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

// Every page a handler asks for has to exist.
//
// Five handlers rendered "admin/error", which was never written. Each of them
// failed while reporting a failure: the answer to "that category is not here" was
// another error, and the explanation an administrator most needed was the thing
// that broke. Nothing noticed, because a page that is missing only breaks when
// something goes wrong, and nothing was going wrong on the happy path.
//
// So the names are read out of the handlers and looked for on disk. Views may
// leave off the extension, and may sit in a directory, so both are tried.
const checkRenderedViewsExist = (file, source) => {
  if (!file.startsWith("controllers/") && !file.startsWith("routes/")) {
    return [];
  }

  const problems = [];
  // Deliberately ".render(" rather than "res.render(": most calls are chained after
  // a status, as in res.status(404).render(...), and looking for "res.render" on
  // its own would match only the few that are not chained — which is how a check
  // like this comes to pass while the thing it exists to catch is still there.
  const viewNames = source.matchAll(/(?<![.\w])\.render\(\s*["'`]([^"'`]+)["'`]/g);

  // One line per name, not one per call: five handlers asking for the same missing
  // view is one mistake, and saying it five times only makes the real list longer.
  const missing = new Map();

  for (const [, view] of viewNames) {
    if (missing.has(view)) {
      continue;
    }

    const candidates = [
      `views/${view}.ejs`,
      `views/${view}`,
      `views/${view}/index.ejs`,
    ];
    if (candidates.some((candidate) => existsSync(candidate))) {
      continue;
    }

    missing.set(view, source.slice(0, source.indexOf(view)).split("\n").length);
  }

  for (const [view, line] of missing) {
    problems.push(
      `${file}:${line} [missing-view] renders "${view}", which is not a view; the answer to a failure would itself be a failure`,
    );
  }

  return problems;
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
  problems.push(...checkRenderedViewsExist(file, source));
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
