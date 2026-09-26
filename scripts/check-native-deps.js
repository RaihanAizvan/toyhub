import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const MODULES = [
  { name: "bcrypt", hint: "native module built with node-gyp" },
];

const probe = ({ name, hint }) => {
  const loaded = require(name);
  if (name === "bcrypt") {
    const hash = loaded.hashSync("native-deps-check", 4);
    if (!loaded.compareSync("native-deps-check", hash)) {
      throw new Error("bcrypt loaded but hashing is broken");
    }
  }
  return hint;
};

const failures = [];

for (const module of MODULES) {
  try {
    probe(module);
  } catch (error) {
    failures.push({ module, error });
  }
}

if (failures.length > 0) {
  console.error("\nToyHub cannot start: a dependency is not usable.\n");
  for (const { module, error } of failures) {
    console.error(`  ${module.name} (${module.hint})`);
    console.error(`  ${error.message}\n`);
  }
  console.error("How to fix:");
  console.error("  1. Reinstall dependencies so install scripts run:");
  console.error("       rm -rf node_modules && npm ci");
  console.error("  2. If that still fails, approve the install script and rebuild:");
  console.error("       npm install-scripts approve bcrypt");
  console.error("       npm rebuild bcrypt --build-from-source");
  console.error("  3. A source build needs python3, make and a C/C++ compiler (build-essential).");
  console.error("  4. Verify the installation without starting the server:");
  console.error("       npm run smoke\n");
  console.error("npm >= 12 blocks dependency install scripts by default. This project");
  console.error("allows the bcrypt install script in package.json (allowScripts), so a");
  console.error("plain `npm ci` is enough on a supported Node version.\n");
  process.exit(1);
}

console.log(`Native dependency check passed (${MODULES.map((m) => m.name).join(", ")}).`);
