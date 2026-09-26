import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import express from "express";
import session from "express-session";
import {
  DEFAULT_COOKIE_NAME,
  DEFAULT_MAX_AGE_MS,
  MIN_PRODUCTION_SECRET_LENGTH,
  buildSessionOptions,
  destroyUserSessions,
  resolveSessionSettings,
} from "../utils/session.js";

const productionSecret = "p".repeat(MIN_PRODUCTION_SECRET_LENGTH + 8);

const baseEnv = (overrides = {}) => ({
  NODE_ENV: "production",
  SESSION_SECRET: productionSecret,
  ...overrides,
});

const buildApp = (settings) => {
  const app = express();
  if (settings.trustProxy !== false) {
    app.set("trust proxy", settings.trustProxy);
  }
  app.use(session(buildSessionOptions(settings, new session.MemoryStore())));
  app.get("/", (req, res) => {
    req.session.value = "written";
    res.send("ok");
  });
  return app;
};

const readSessionCookie = async (settings, headers = {}) => {
  const server = buildApp(settings).listen(0);
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/`, {
      headers,
      redirect: "manual",
    });
    const cookies = response.headers.getSetCookie();
    return cookies.find((cookie) => cookie.startsWith(`${settings.name}=`)) ?? "";
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
};

describe("session configuration", () => {
  it("enforces secure cookies and an explicit store in production", () => {
    const settings = resolveSessionSettings(baseEnv());

    assert.equal(settings.secureEnvironment, true);
    assert.equal(settings.secure, true);
    assert.equal(settings.sameSite, "lax");
    assert.equal(settings.name, DEFAULT_COOKIE_NAME);
    assert.equal(settings.maxAge, DEFAULT_MAX_AGE_MS);
    assert.equal(settings.trustProxy, 1);

    const options = buildSessionOptions(settings, { store: true });
    assert.equal(options.cookie.httpOnly, true);
    assert.equal(options.cookie.secure, true);
    assert.equal(options.cookie.sameSite, "lax");
    assert.equal(options.cookie.path, "/");
    assert.equal(options.resave, false);
    assert.equal(options.saveUninitialized, false);
    assert.ok(options.store);
  });

  it("never enables production cookie behaviour in development", () => {
    const settings = resolveSessionSettings(
      baseEnv({ NODE_ENV: "development", SESSION_SECRET: "short-dev-secret" }),
    );

    assert.equal(settings.secureEnvironment, false);
    assert.equal(settings.secure, false);
    assert.equal(settings.trustProxy, false);
  });

  it("rejects a missing or unknown NODE_ENV", () => {
    assert.throws(
      () => resolveSessionSettings({ SESSION_SECRET: productionSecret }),
      /Missing required environment variable: NODE_ENV/,
    );
    assert.throws(
      () => resolveSessionSettings(baseEnv({ NODE_ENV: "stagin" })),
      /NODE_ENV must be one of/,
    );
  });

  it("requires a long session secret in production only", () => {
    assert.throws(
      () => resolveSessionSettings(baseEnv({ SESSION_SECRET: "tooshort" })),
      /SESSION_SECRET must be at least/,
    );
    assert.equal(
      resolveSessionSettings(baseEnv({ NODE_ENV: "staging" })).secure,
      true,
    );
    assert.throws(
      () =>
        resolveSessionSettings(
          baseEnv({ NODE_ENV: "staging", SESSION_SECRET: "tooshort" }),
        ),
      /SESSION_SECRET must be at least/,
    );
  });

  it("validates SameSite, max age and trust proxy overrides", () => {
    assert.equal(
      resolveSessionSettings(baseEnv({ SESSION_COOKIE_SAME_SITE: "None" })).secure,
      true,
    );
    assert.equal(
      resolveSessionSettings(
        baseEnv({ NODE_ENV: "development", SESSION_COOKIE_SAME_SITE: "none" }),
      ).secure,
      true,
    );
    assert.throws(
      () => resolveSessionSettings(baseEnv({ SESSION_COOKIE_SAME_SITE: "nope" })),
      /SESSION_COOKIE_SAME_SITE must be one of/,
    );
    assert.equal(
      resolveSessionSettings(baseEnv({ SESSION_MAX_AGE_MS: "60000" })).maxAge,
      60000,
    );
    assert.throws(
      () => resolveSessionSettings(baseEnv({ SESSION_MAX_AGE_MS: "0" })),
      /SESSION_MAX_AGE_MS must be a positive integer/,
    );
    assert.equal(resolveSessionSettings(baseEnv({ TRUST_PROXY: "2" })).trustProxy, 2);
    assert.equal(
      resolveSessionSettings(baseEnv({ TRUST_PROXY: "false" })).trustProxy,
      false,
    );
    assert.throws(
      () => resolveSessionSettings(baseEnv({ TRUST_PROXY: "all" })),
      /TRUST_PROXY must be a boolean or a non-negative integer/,
    );
  });
});

describe("session cookies over http", () => {
  it("sets HttpOnly, Secure and SameSite cookies behind a trusted proxy", async () => {
    const cookie = await readSessionCookie(resolveSessionSettings(baseEnv()), {
      "x-forwarded-proto": "https",
    });

    assert.match(cookie, /^toyhub\.sid=/);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /Secure/i);
    assert.match(cookie, /SameSite=Lax/i);
    assert.match(cookie, /Path=\//i);
  });

  it("does not mark development cookies as secure", async () => {
    const settings = resolveSessionSettings(
      baseEnv({ NODE_ENV: "development", SESSION_SECRET: "short-dev-secret" }),
    );
    const cookie = await readSessionCookie(settings, {
      "x-forwarded-proto": "https",
    });

    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    assert.doesNotMatch(cookie, /Secure/i);
  });
});

describe("session invalidation", () => {
  const createSession = (store, userId) =>
    new Promise((resolve) => {
      const sessionId = randomUUID();
      store.set(sessionId, { cookie: {}, user: { id: userId } }, () =>
        resolve(sessionId),
      );
    });

  const readSession = (store, sessionId) =>
    new Promise((resolve) => {
      store.get(sessionId, (error, value) => resolve(error ? null : value ?? null));
    });

  it("destroys only the sessions of the given account", async () => {
    const store = new session.MemoryStore();
    const target = await createSession(store, "user-1");
    const other = await createSession(store, "user-2");
    await createSession(store, "user-1");

    assert.equal(await destroyUserSessions(store, "user-1"), 2);
    assert.equal(await readSession(store, target), null);
    assert.ok(await readSession(store, other));
  });

  it("is a no-op when the account has no sessions", async () => {
    const store = new session.MemoryStore();
    assert.equal(await destroyUserSessions(store, "user-1"), 0);
    assert.equal(await destroyUserSessions(null, "user-1"), 0);
  });
});

describe("session source guards", () => {
  it("wires the shared store through the session helper", async () => {
    const serverSource = await readFile(
      new URL("../server.js", import.meta.url),
      "utf8",
    );

    assert.match(serverSource, /resolveSessionSettings\(\)/);
    assert.match(serverSource, /createSessionMiddleware\(sessionSettings\)/);
    assert.match(serverSource, /app\.set\("trust proxy"/);
    assert.doesNotMatch(serverSource, /express-session/);
    assert.doesNotMatch(serverSource, /MemoryStore/);
    assert.doesNotMatch(serverSource, /saveUninitialized:\s*true/);
  });

  it("invalidates sessions on logout and account changes", async () => {
    const authSource = await readFile(
      new URL("../controllers/userModules/auth.js", import.meta.url),
      "utf8",
    );
    const adminLoginSource = await readFile(
      new URL("../controllers/adminModules/login.js", import.meta.url),
      "utf8",
    );
    const addressSource = await readFile(
      new URL("../controllers/userModules/address.js", import.meta.url),
      "utf8",
    );
    const blockSource = await readFile(
      new URL("../controllers/adminModules/block.js", import.meta.url),
      "utf8",
    );
    const middlewareSource = await readFile(
      new URL("../middlewares/userMiddleware.js", import.meta.url),
      "utf8",
    );

    assert.doesNotMatch(authSource, /connect\.sid/);
    assert.match(authSource, /regenerateSession\(req\)/);
    assert.match(authSource, /clearSessionCookie\(res\)/);
    assert.match(authSource, /invalidateUserSessions\(user\._id\)/);
    assert.match(adminLoginSource, /regenerateSession\(req\)/);
    assert.match(adminLoginSource, /clearSessionCookie\(res\)/);
    assert.match(addressSource, /invalidateUserSessions\(user\._id\)/);
    assert.match(blockSource, /invalidateUserSessions\(userId\)/);
    assert.match(middlewareSource, /req\.session\.user\.id/);
    assert.doesNotMatch(middlewareSource, /req\.session\.user\._id/);
  });
});
