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
  "scripts/probe-user-pages.js",
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

const collectViewFiles = () =>
  execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "views/"], {
    encoding: "utf8",
  })
    .split("\n")
    .map((line) => line.trim())
    .filter((file) => file && file.endsWith(".ejs"));

const checkSyntax = (file) => {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    return null;
  } catch (error) {
    const output = `${error.stderr || ""}${error.stdout || ""}`.trim();
    return output || "syntax error";
  }
};

// A view that reads through a populated reference needs to say what happens when
// that reference is missing, because the thing it points at can be deleted while
// something still points at it.
//
// This is the same bug as the missing views, one layer in: an administrator
// deletes a category, and the home page answers 500 to everybody because a card
// asked a deleted row for its name. It is easy to miss because nothing is wrong
// until the deletion happens, which may be months after the view was written.
//
// So the references a view reads straight through are named, and each one has to
// be guarded or acknowledged nearby. A comment counts as acknowledgement, because
// the other way to fix this is to change the query so the row never arrives — and
// that deserves to be written down rather than left to be rediscovered.
const POPULATED_REFERENCES = [
  "category",
  "product",
  "user",
  "offers",
  "availableOffers",
  "address",
  "payment",
  "wishlist",
];

// What a guarded read looks like. The shapes here are the ones this shop already
// uses: a truthiness check before the read, optional chaining, a fallback on the
// value itself, or a filter that drops the missing entries before iterating.
const GUARDS = [
  /\?\./,
  /&&/,
  /\?\s*[^:]*:/,
  /\|\|/,
  /\bif\s*\(/,
  /\.filter\(Boolean\)/,
  /\?\s*\(/,
  /\bloch \|\|/,
];

const checkUnguardedReferences = (file, source) => {
  if (!file.startsWith("views/") || !file.endsWith(".ejs")) {
    return [];
  }

  const problems = [];
  const lines = source.split(/\r?\n/);

  // A guard is often several lines above the read it protects — an `if` opens, the
  // read sits inside it, and the `if` closes below. Reading one line at a time
  // cannot see that, and would report every correctly guarded read in the shop as
  // unguarded, which is how a check like this gets switched off.
  //
  // So the two are related: an EJS block that opens and does not close inside the
  // same line is carried forward until it closes, and the guards inside it count
  // for the reads inside it. That is what "inside" means to the template, and
  // reading it any other way produces a rule nobody can satisfy.
  let openBlocks = 0;
  let guardsInScope = false;
  let inRawBlock = false;

  lines.forEach((line, index) => {
    // Whether this line leaves a block open, counted in braces rather than in tags,
    // because the two do not agree: `<% if (x) { %>` opens a tag and closes it on
    // the same line, and counting tags says it is balanced when it plainly is not.
    // Inside a <style> or <script> block, braces belong to CSS and JavaScript, not
    // to the template. Counting them left the counter permanently off by whatever
    // the page's stylesheet happened to balance to, which is how a correctly
    // guarded read inside a styled page got reported.
    const rawBlockOpens = /<(style|script)\b/i.test(line);
    const rawBlockEnds = /<\/(style|script)>/i.test(line);

    let braces = 0;
    if (!inRawBlock || !rawBlockEnds) {
      braces = (line.match(/{/g) ?? []).length - (line.match(/}/g) ?? []).length;
    }
    const isStatement =
      /<%\s*(?![-=#%])\s*[\s\S]*?%>/.test(line) && !/<%=/.test(line);

    if (isStatement) {
      guardsInScope = GUARDS.some((guard) => guard.test(line)) || /\belse\b/.test(line);
    }

    // A block that opens here and closes further down protects the reads between
    // them, which is the ordinary shape of a guard: open, read, close.
    const opensBlock = braces > 0 && /\b(if|else|forEach|for|map|filter)\b/.test(line);

    const guarded = openBlocks > 0 ? guardsInScope || isStatement : guardsInScope;

    // Only lines that print something can end a page; a read used to decide
    // something is already being asked whether it is there.
    if (/<%=/.test(line) || /<%\s*-/.test(line)) {
      for (const reference of POPULATED_REFERENCES) {
        const pattern = new RegExp(`\\.${reference}\\.`, "g");
        for (const match of line.matchAll(pattern)) {
          // Read as `x?.category.name` — the optional chain is on the reference.
          if (line.slice(0, match.index).endsWith("?")) {
            continue;
          }
          // Either the read's own line is guarded — `(x && x.name) ? x.name : '-'`
          // is the shape most of this shop uses — or an enclosing block opened with
          // a guard and the read sits inside it.
          if (guarded || GUARDS.some((guard) => guard.test(line))) {
            continue;
          }

          problems.push(
            `${file}:${index + 1} [unguarded-reference] reads through .${reference}. with nothing to handle it being gone; a deleted ${reference} would end this page`,
          );
        }
      }
    }

    if (rawBlockEnds) {
      inRawBlock = false;
    } else if (rawBlockOpens) {
      inRawBlock = true;
    }

    // Accumulated, not assigned: a line with no braces at all sits happily inside
    // an open block — the markup between `<% if (...) { %>` and `<% } %>` — and
    // treating "no braces here" as "balanced" closed the block on the first line of
    // HTML after the guard, which reported the guarded reads themselves as
    // unguarded.
    openBlocks += braces;
    if (opensBlock) {
      guardsInScope = true;
    }
    if (openBlocks <= 0) {
      openBlocks = 0;
      guardsInScope = false;
    }
  });

  return problems;
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
const viewFiles = collectViewFiles();
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

// The view rules walk the templates themselves, which is why they are a separate
// pass and not part of the JavaScript one. They are about what a view asks of the
// data it is given, and a template is not JavaScript even though it runs some.
for (const file of viewFiles) {
  problems.push(...checkUnguardedReferences(file, readFileSync(file, "utf8")));
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
