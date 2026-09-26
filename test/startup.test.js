import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import bcrypt from "bcrypt";
import { spawnEnv } from "./helpers/test-env.js";

const runScript = (script) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      env: spawnEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, output }));
  });

describe("local startup requirements", () => {
  it("hashes and verifies a password with the native bcrypt binding", async () => {
    const hash = await bcrypt.hash("smoke-test-password", 4);
    assert.match(hash, /^\$2[aby]\$04\$/);
    assert.equal(await bcrypt.compare("smoke-test-password", hash), true);
    assert.equal(await bcrypt.compare("wrong-password", hash), false);
  });

  it("reports the native dependency check as passing", async () => {
    const { code, output } = await runScript("scripts/check-native-deps.js");
    assert.equal(code, 0, output);
    assert.match(output, /Native dependency check passed/);
  });

  it("passes the full startup smoke check", async () => {
    const { code, output } = await runScript("scripts/smoke-startup.js");
    assert.equal(code, 0, output);
    assert.match(output, /Startup smoke check passed/);
    assert.match(output, /Loaded \d+ application modules/);
  });

  it("declares the runtime and allows the bcrypt install script", async () => {
    const pkg = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    );

    assert.ok(pkg.engines?.node, "engines.node must be declared");
    assert.ok(pkg.engines?.npm, "engines.npm must be declared");
    assert.equal(pkg.allowScripts?.bcrypt, true);
    assert.equal(pkg.scripts?.prestart, "node scripts/check-native-deps.js");
    assert.equal(pkg.scripts?.smoke, "node scripts/smoke-startup.js");

    const nvmrc = await readFile(new URL("../.nvmrc", import.meta.url), "utf8");
    assert.match(nvmrc.trim(), /^\d+(\.\d+){0,2}$/);
  });

  it("keeps package manifests under version control", async () => {
    const gitignore = await readFile(
      new URL("../.gitignore", import.meta.url),
      "utf8",
    );
    const entries = gitignore
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("!"));

    assert.ok(!entries.includes("package.json"));
    assert.ok(!entries.includes("package-lock.json"));
    assert.ok(entries.includes(".env"));
  });
});
