import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, describe, it } from "node:test";
import {
  assertRequiredEnv,
  readEnv,
  requireEnv,
  requiredEnvironmentVariables,
} from "../utils/config.js";

const envBackup = new Map();

const rememberEnv = (name) => {
  if (!envBackup.has(name)) {
    envBackup.set(name, process.env[name]);
  }
};

const setEnv = (name, value) => {
  rememberEnv(name);
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
};

const setRequiredEnv = () => {
  for (const name of requiredEnvironmentVariables) {
    setEnv(name, "test-value");
  }
};

describe("environment configuration", () => {
  afterEach(() => {
    for (const [name, value] of envBackup) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
    envBackup.clear();
  });

  it("trims values and rejects missing variables", () => {
    setEnv("TOYHUB_TEST_SECRET", "  test-value  ");
    assert.equal(readEnv("TOYHUB_TEST_SECRET"), "test-value");
    assert.equal(requireEnv("TOYHUB_TEST_SECRET"), "test-value");

    setEnv("TOYHUB_TEST_SECRET", undefined);
    assert.throws(
      () => requireEnv("TOYHUB_TEST_SECRET"),
      /Missing required environment variable: TOYHUB_TEST_SECRET/,
    );
  });

  it("reports every missing required variable", () => {
    setRequiredEnv();
    setEnv("SESSION_SECRET", undefined);

    assert.throws(
      () => assertRequiredEnv(),
      /Missing required environment variables: .*SESSION_SECRET/,
    );
  });
});

describe("secret source guards", () => {
  it("does not contain hard-coded session, mail, or database credentials", async () => {
    const serverSource = await readFile(
      new URL("../server.js", import.meta.url),
      "utf8",
    );
    const authSource = await readFile(
      new URL("../controllers/userModules/auth.js", import.meta.url),
      "utf8",
    );
    const databaseSource = await readFile(
      new URL("../models/main.models.js", import.meta.url),
      "utf8",
    );

    assert.doesNotMatch(serverSource, /secret:\s*['"][^'"]+['"]/);
    assert.match(serverSource, /requireEnv\("SESSION_SECRET"\)/);
    assert.doesNotMatch(authSource, /user:\s*['"][^'"]+['"]/);
    assert.doesNotMatch(authSource, /pass:\s*['"][^'"]+['"]/);
    assert.doesNotMatch(authSource, /@gmail\.com/);
    assert.doesNotMatch(databaseSource, /process\.env\.MONGO_URI/);
  });

  it("does not seed or prefill the legacy admin credentials", async () => {
    const loginSource = await readFile(
      new URL("../controllers/adminModules/login.js", import.meta.url),
      "utf8",
    );
    const loginView = await readFile(
      new URL("../views/admin/adminLogin.ejs", import.meta.url),
      "utf8",
    );

    assert.doesNotMatch(loginSource, /email:\s*['"][^'"]+['"]/);
    assert.doesNotMatch(loginSource, /password:\s*['"][^'"]+['"]/);
    assert.doesNotMatch(loginView, /value="admin/);
  });

  it("reads payment secrets through centralized configuration", async () => {
    const checkoutSource = await readFile(
      new URL("../controllers/userModules/checkout.js", import.meta.url),
      "utf8",
    );
    const passportSource = await readFile(
      new URL("../utils/passport.js", import.meta.url),
      "utf8",
    );

    assert.doesNotMatch(checkoutSource, /process\.env\.RAZOR_SECRET_ID/);
    assert.doesNotMatch(passportSource, /process\.env\.CLIENT_SECRET/);
  });
});
