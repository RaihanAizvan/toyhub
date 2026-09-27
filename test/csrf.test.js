import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import express from "express";
import expressLayouts from "express-ejs-layouts";
import session from "express-session";
import path from "node:path";
import { fileURLToPath } from "node:url";
import userAuth from "../controllers/userModules/auth.js";
import { setMailTransport } from "../utils/mailer.js";
import {
  CSRF_FIELD_NAME,
  CSRF_HEADER_NAME,
  exposeCsrfToken,
  injectCsrfFields,
  verifyCsrfRequest,
} from "../utils/csrf.js";
import { applyTestEnv } from "./helpers/test-env.js";
import { canReachTestDatabase, withTestDatabase } from "./helpers/test-db.js";
import { createUser } from "./helpers/fixtures.js";

applyTestEnv();
setMailTransport({ sendMail: async () => ({ messageId: "csrf-test" }) });

const viewsDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "views",
);

const buildApp = () => {
  const app = express();
  app.set("views", viewsDirectory);
  app.set("view engine", "ejs");
  app.use(expressLayouts);
  app.set("layout", "./layouts/layout");
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(
    session({
      name: "toyhub.sid",
      secret: "c".repeat(32),
      resave: false,
      saveUninitialized: false,
    }),
  );

  // Mirror the locals the real server exposes to every view.
  app.use((req, res, next) => {
    res.locals.toast = req.session.toast;
    delete req.session.toast;
    res.locals.flashMessage = req.session.flashMessage;
    delete req.session.flashMessage;
    res.locals.name = req.session.user?.name;
    next();
  });

  // The CSRF pair, wired exactly as in server.js.
  app.locals.injectCsrfFields = injectCsrfFields;
  app.use(exposeCsrfToken);
  app.use(verifyCsrfRequest);

  app.get("/user/login", (req, res) =>
    res.render("user/login", { title: "Login", message: "", email: "", password: "" }),
  );
  // Renders the same way whether or not somebody is signed in.
  app.get("/token", (req, res) =>
    res.render("admin/adminLogin", { title: "Admin Login", error: "" }),
  );
  app.post("/user/login", userAuth.postLogin);
  app.get("/user/logout", userAuth.getLogout);
  app.post("/demo", (req, res) => res.json({ ok: true, echo: req.body?.value ?? null }));

  return app;
};

let server;
let baseUrl;
let reachable = false;

const request = async (path, { method = "GET", body, cookie, origin, csrf } = {}) => {
  const headers = {};
  if (body) headers["content-type"] = "application/x-www-form-urlencoded";
  if (cookie) headers.cookie = cookie;
  if (origin) headers.origin = origin;
  if (csrf) headers[CSRF_HEADER_NAME] = csrf;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    redirect: "manual",
    headers,
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
  return {
    status: response.status,
    location: response.headers.get("location"),
    contentType: response.headers.get("content-type"),
    cookie: response.headers.getSetCookie?.()[0]?.split(";")[0] ?? null,
    text: await response.text(),
  };
};

const tokenFrom = (html) => {
  const field = new RegExp(`name="${CSRF_FIELD_NAME}" value="([a-f0-9]+)"`).exec(html);
  if (field) {
    return field[1];
  }
  const meta = /<meta name="csrf-token" content="([a-f0-9]+)">/.exec(html);
  assert.ok(meta, "the rendered page must carry a CSRF token");
  return meta[1];
};

const loginPage = async () => {
  const page = await request("/user/login");
  assert.equal(page.status, 200);
  return { token: tokenFrom(page.text), cookie: page.cookie, html: page.text };
};

before(async () => {
  reachable = await canReachTestDatabase();
  if (!reachable) {
    return;
  }
  const listener = buildApp().listen(0);
  await new Promise((resolve) => listener.once("listening", resolve));
  server = listener;
  baseUrl = `http://127.0.0.1:${listener.address().port}`;
});

after(async () => {
  if (server) {
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections?.();
    });
  }
});

const withDatabase = (run) => (reachable ? withTestDatabase(run) : null);
const skipWithoutDatabase = (t) => {
  if (!reachable) {
    t.skip("no MongoDB on the test URI");
    return true;
  }
  return false;
};

describe("token delivery", () => {
  it("injects the token into rendered forms and publishes it for scripts", async (t) => {
    if (skipWithoutDatabase(t)) return;
    await withDatabase(async () => {
      const { token, html } = await loginPage();
      assert.match(token, /^[a-f0-9]{64}$/);
      assert.match(html, /<meta name="csrf-token" content="[a-f0-9]{64}">/);
      assert.ok(html.includes(token), "the head and the form must share one token");
      assert.ok(!html.includes("undefined"), "no view may render an empty token");
    });
  });

  it("adds the field to every form on the page", () => {
    const token = "a".repeat(64);
    const html = injectCsrfFields(
      '<form action="/a"><input name="x"></form><form action="/b"></form>',
      token,
    );
    assert.equal(html.match(new RegExp(CSRF_FIELD_NAME, "g")).length, 2);
    assert.equal(injectCsrfFields("<div>no forms</div>", token), "<div>no forms</div>");
    assert.equal(injectCsrfFields('<form action="/a">', null), '<form action="/a">');
  });
});

describe("state changing requests", () => {
  it("accepts a form post that carries the token", async (t) => {
    if (skipWithoutDatabase(t)) return;
    await withDatabase(async () => {
      const { token, cookie } = await loginPage();
      const response = await request("/demo", {
        method: "POST",
        cookie,
        body: { value: "kept", [CSRF_FIELD_NAME]: token },
      });
      assert.equal(response.status, 200);
      assert.match(response.text, /"ok":true/);
    });
  });

  it("accepts the same token in a header, the way axios sends it", async (t) => {
    if (skipWithoutDatabase(t)) return;
    await withDatabase(async () => {
      const { token, cookie } = await loginPage();
      const response = await request("/demo", {
        method: "POST",
        cookie,
        csrf: token,
        body: { value: "via-header" },
      });
      assert.equal(response.status, 200);
      assert.match(response.text, /via-header/);
    });
  });

  it("blocks a post without a token and performs no mutation", async (t) => {
    if (skipWithoutDatabase(t)) return;
    await withDatabase(async () => {
      const { cookie } = await loginPage();
      const response = await request("/demo", {
        method: "POST",
        cookie,
        body: { value: "should-not-happen" },
      });
      assert.equal(response.status, 403);
      assert.doesNotMatch(response.text, /should-not-happen/);
      assert.match(response.text, /was blocked/);
      // The layout must already be in place when a request is blocked.
      assert.match(response.text, /\/js\/dom\.js/);
    });
  });

  it("blocks a post with a wrong token", async (t) => {
    if (skipWithoutDatabase(t)) return;
    await withDatabase(async () => {
      const { cookie } = await loginPage();
      const response = await request("/demo", {
        method: "POST",
        cookie,
        body: { value: "nope", [CSRF_FIELD_NAME]: "b".repeat(64) },
      });
      assert.equal(response.status, 403);
    });
  });

  it("blocks a token that belongs to another session", async (t) => {
    if (skipWithoutDatabase(t)) return;
    await withDatabase(async () => {
      const first = await loginPage();
      const second = await loginPage();
      const response = await request("/demo", {
        method: "POST",
        cookie: second.cookie,
        body: { value: "cross-session", [CSRF_FIELD_NAME]: first.token },
      });
      assert.equal(response.status, 403);
    });
  });

  it("blocks a valid token sent from a foreign origin", async (t) => {
    if (skipWithoutDatabase(t)) return;
    await withDatabase(async () => {
      const { token, cookie } = await loginPage();
      const response = await request("/demo", {
        method: "POST",
        cookie,
        origin: "https://evil.example",
        body: { value: "cross-origin", [CSRF_FIELD_NAME]: token },
      });
      assert.equal(response.status, 403);
      assert.doesNotMatch(response.text, /cross-origin/);
    });
  });

  it("answers a blocked request with json for ajax callers", async (t) => {
    if (skipWithoutDatabase(t)) return;
    await withDatabase(async () => {
      const { cookie } = await loginPage();
      const response = await request("/demo", {
        method: "POST",
        cookie,
        csrf: "c".repeat(64),
        body: { value: "ajax" },
      });
      assert.equal(response.status, 403);
      assert.match(response.contentType ?? "", /json/);
      assert.match(response.text, /Invalid or missing CSRF token/);
    });
  });

  it("leaves safe requests alone", async (t) => {
    if (skipWithoutDatabase(t)) return;
    await withDatabase(async () => {
      const { cookie } = await loginPage();
      assert.equal((await request("/user/login", { cookie })).status, 200);
      assert.equal((await request("/demo", { cookie })).status, 404);
    });
  });
});

describe("token lifetime", () => {
  it("cannot be replayed after logging in, because the session rotates", async (t) => {
    if (skipWithoutDatabase(t)) return;
    await withDatabase(async () => {
      const user = await createUser({ email: "csrf.login@example.invalid" });
      const page = await loginPage();

      const login = await request("/user/login", {
        method: "POST",
        cookie: page.cookie,
        body: {
          email: user.email,
          password: "TestPassw0rd!",
          [CSRF_FIELD_NAME]: page.token,
        },
      });
      assert.equal(login.status, 302);

      const replay = await request("/demo", {
        method: "POST",
        cookie: login.cookie,
        body: { value: "replay", [CSRF_FIELD_NAME]: page.token },
      });
      assert.equal(replay.status, 403);

      const nextPage = await request("/token", { cookie: login.cookie });
      assert.equal(nextPage.status, 200);
      const fresh = await request("/demo", {
        method: "POST",
        cookie: login.cookie,
        body: { value: "fresh", [CSRF_FIELD_NAME]: tokenFrom(nextPage.text) },
      });
      assert.equal(fresh.status, 200);
      assert.notEqual(tokenFrom(nextPage.text), page.token, "login must rotate the token");
    });
  });

  it("cannot be replayed after logging out, because the session is destroyed", async (t) => {
    if (skipWithoutDatabase(t)) return;
    await withDatabase(async () => {
      const user = await createUser({ email: "csrf.logout@example.invalid" });
      const page = await loginPage();
      const login = await request("/user/login", {
        method: "POST",
        cookie: page.cookie,
        body: {
          email: user.email,
          password: "TestPassw0rd!",
          [CSRF_FIELD_NAME]: page.token,
        },
      });
      assert.equal(login.status, 302);

      const before = await request("/token", { cookie: login.cookie });
      const token = tokenFrom(before.text);

      const logout = await request("/user/logout", { cookie: login.cookie });
      assert.equal(logout.status, 302);
      assert.equal(logout.cookie, "toyhub.sid=");

      const replay = await request("/demo", {
        method: "POST",
        cookie: before.cookie,
        body: { value: "after-logout", [CSRF_FIELD_NAME]: token },
      });
      assert.equal(replay.status, 403);
    });
  });
});
