import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MODULE_DIRECTORIES = ["controllers", "middlewares", "models", "routes", "utils"];

const collectModules = async (directory) => {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => `${directory}/${entry.name}`);
};

const run = (command, args) =>
  new Promise((resolve) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit" });
    child.on("close", (code) => resolve(code ?? 1));
  });

const failures = [];

console.log("ToyHub startup smoke check\n");

const nativeDepsExit = await run(process.execPath, ["scripts/check-native-deps.js"]);
if (nativeDepsExit !== 0) {
  failures.push("native dependency check failed");
}

const moduleFiles = (
  await Promise.all(MODULE_DIRECTORIES.map(collectModules))
).flat();

for (const file of moduleFiles) {
  try {
    await import(path.join(root, file));
  } catch (error) {
    failures.push(`${file}: ${error.message}`);
  }
}

if (failures.length === 0) {
  console.log(`Loaded ${moduleFiles.length} application modules.`);
}

try {
  const { assertRequiredEnv } = await import(path.join(root, "utils/config.js"));
  assertRequiredEnv();
  console.log("Environment configuration is complete.");
} catch (error) {
  failures.push(`environment: ${error.message}`);
}

if (failures.length > 0) {
  console.error("\nStartup smoke check failed:\n");
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  console.error("");
  process.exit(1);
}

console.log("\nStartup smoke check passed. Start the app with `npm start`.");
