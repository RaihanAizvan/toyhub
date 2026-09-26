import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import express from "express";
import session from "express-session";
import path from "node:path";
import { fileURLToPath } from "node:url";
import adminAuth from "../controllers/adminModules/login.js";
import adminMiddleware from "../middlewares/adminMiddleware.js";
import AdminUser from "../models/admin.models.js";
import User from "../models/users.models.js";
import { applyTestEnv } from "./helpers/test-env.js";
import {
  canReachTestDatabase,
  withTestDatabase,
} from "./helpers/test-db.js";
import { createAdmin, createUser } from "./helpers/fixtures.js";

applyTestEnv();

const viewsDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "views",
);

const buildApp = () => {
  const app = express();
  app.set("views", viewsDirectory);
  app.set("view engine", "ejs");
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(
    session({
      name: "toyhub.sid",
      secret: "t".repeat(32),
      resave: false,
      saveUninitialized: false,
    }),
  );

  app.get("/admin/login", adminAuth.getLogin);
  app.post("/admin/login", adminAuth.postLogin);
  app.post("/admin/logout", adminAuth.postLogout);
  app.get("/admin", adminMiddleware.isAdmin, (req, res) =>
    res.json({ ok: true, role: req.admin.role, email: req.admin.email }),
  );

  return app;
};

const startServer = async () => {
  const server = buildApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections?.();
      }),
  };
};

const postForm = async (baseUrl, path, body, cookie) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(cookie ? { cookie } : {}),
    },
    body: new URLSearchParams(body).toString(),
  });
  return {
    response,
    cookie: response.headers.getSetCookie?.()[0]?.split(";")[0] ?? null,
  };
};

describe("admin authentication", { skip: false }, () => {
  let server;
  let reachable = false;

  before(async () => {
    reachable = await canReachTestDatabase();
    if (reachable) {
      server = await startServer();
    }
  });

  after(async () => {
    if (server) {
      await server.close();
    }
  });

  const withDatabase = async (run) => {
    if (!reachable) {
      return null;
    }
    return withTestDatabase(run);
  };

  it("stores the admin password hashed and never in plaintext", async (t) => {
    if (!reachable) {
      return t.skip("no MongoDB on the test URI");
    }
    await withDatabase(async () => {
      const admin = await createAdmin({ password: "TestAdminPassw0rd!" });
      const stored = await AdminUser.findById(admin._id).lean();
      assert.notEqual(stored.password, "TestAdminPassw0rd!");
      assert.match(stored.password, /^\$2[aby]\$\d{2}\$/);
      assert.equal(stored.email, stored.email.toLowerCase());
    });
  });

  it("rejects an unknown account, a wrong password and a non-admin account identically", async (t) => {
    if (!reachable) {
      return t.skip("no MongoDB on the test URI");
    }
    await withDatabase(async () => {
      const admin = await createAdmin();
      await createUser({ email: "user.only@example.invalid" });

      const wrongPassword = await postForm(server.baseUrl, "/admin/login", {
        email: admin.email,
        password: "WrongPassw0rd!",
      });
      const unknownAccount = await postForm(server.baseUrl, "/admin/login", {
        email: "nobody@example.invalid",
        password: "WrongPassw0rd!",
      });
      const userAccount = await postForm(server.baseUrl, "/admin/login", {
        email: "user.only@example.invalid",
        password: "TestPassw0rd!",
      });

      for (const attempt of [wrongPassword, unknownAccount, userAccount]) {
        assert.equal(attempt.response.status, 401);
        const body = await attempt.response.text();
        assert.match(body, /Invalid email or password/);
        assert.doesNotMatch(body, /nobody@example\.invalid/);
        assert.doesNotMatch(body, /does not exist/i);
      }
    });
  });

  it("rejects a deactivated admin account", async (t) => {
    if (!reachable) {
      return t.skip("no MongoDB on the test URI");
    }
    await withDatabase(async () => {
      const admin = await createAdmin({ isActive: false });
      const attempt = await postForm(server.baseUrl, "/admin/login", {
        email: admin.email,
        password: "TestAdminPassw0rd!",
      });
      assert.equal(attempt.response.status, 401);
    });
  });

  it("signs an active admin in and records the login time", async (t) => {
    if (!reachable) {
      return t.skip("no MongoDB on the test URI");
    }
    await withDatabase(async () => {
      const admin = await createAdmin();
      const before = Date.now();
      const attempt = await postForm(server.baseUrl, "/admin/login", {
        email: admin.email.toUpperCase(),
        password: "TestAdminPassw0rd!",
      });

      assert.equal(attempt.response.status, 302);
      assert.equal(attempt.response.headers.get("location"), "/admin");

      const stored = await AdminUser.findById(admin._id).lean();
      assert.ok(stored.lastLogin.getTime() >= before - 1000);

      const dashboard = await fetch(`${server.baseUrl}/admin`, {
        redirect: "manual",
        headers: { cookie: attempt.cookie },
      });
      assert.equal(dashboard.status, 200);
      const payload = await dashboard.json();
      assert.equal(payload.email, admin.email);
      assert.ok(["admin", "superadmin"].includes(payload.role));
    });
  });

  it("revokes admin access as soon as the account is deactivated", async (t) => {
    if (!reachable) {
      return t.skip("no MongoDB on the test URI");
    }
    await withDatabase(async () => {
      const admin = await createAdmin();
      const attempt = await postForm(server.baseUrl, "/admin/login", {
        email: admin.email,
        password: "TestAdminPassw0rd!",
      });
      assert.equal(attempt.response.status, 302);

      await AdminUser.updateOne({ _id: admin._id }, { $set: { isActive: false } });

      const dashboard = await fetch(`${server.baseUrl}/admin`, {
        redirect: "manual",
        headers: { cookie: attempt.cookie },
      });
      assert.equal(dashboard.status, 302);
      assert.equal(dashboard.headers.get("location"), "/admin/login");
    });
  });

  it("revokes admin access when the role is no longer an admin role", async (t) => {
    if (!reachable) {
      return t.skip("no MongoDB on the test URI");
    }
    await withDatabase(async () => {
      const admin = await createAdmin();
      const attempt = await postForm(server.baseUrl, "/admin/login", {
        email: admin.email,
        password: "TestAdminPassw0rd!",
      });

      await AdminUser.collection.updateOne(
        { _id: admin._id },
        { $set: { role: "viewer" } },
      );

      const dashboard = await fetch(`${server.baseUrl}/admin`, {
        redirect: "manual",
        headers: { cookie: attempt.cookie },
      });
      assert.equal(dashboard.status, 302);
      assert.equal(dashboard.headers.get("location"), "/admin/login");
    });
  });

  it("destroys the session on logout and clears the cookie", async (t) => {
    if (!reachable) {
      return t.skip("no MongoDB on the test URI");
    }
    await withDatabase(async () => {
      const admin = await createAdmin();
      const login = await postForm(server.baseUrl, "/admin/login", {
        email: admin.email,
        password: "TestAdminPassw0rd!",
      });

      const logout = await postForm(server.baseUrl, "/admin/logout", {}, login.cookie);
      assert.equal(logout.response.status, 302);
      assert.equal(logout.response.headers.get("location"), "/admin/login");
      assert.match(
        logout.response.headers.getSetCookie().join(";"),
        /toyhub\.sid=;/,
      );
    });
  });

  it("creates the bootstrap admin from the environment with a hashed password", async (t) => {
    if (!reachable) {
      return t.skip("no MongoDB on the test URI");
    }
    await withDatabase(async () => {
      const previousEmail = process.env.ADMIN_EMAIL;
      const previousPassword = process.env.ADMIN_PASSWORD;
      process.env.ADMIN_EMAIL = "Bootstrap.Admin@Example.Invalid";
      process.env.ADMIN_PASSWORD = "BootstrapPassw0rd!";

      try {
        const created = await adminAuth.ensureBootstrapAdmin();
        assert.ok(created);
        assert.equal(created.email, "bootstrap.admin@example.invalid");
        assert.equal(created.role, "superadmin");
        assert.equal(created.isActive, true);
        assert.match(created.password, /^\$2[aby]\$12\$/);
        assert.equal(await bcryptCompare(created.password), true);

        const again = await adminAuth.ensureBootstrapAdmin();
        assert.equal(again._id.toString(), created._id.toString());
        assert.equal(await AdminUser.countDocuments(), 1);
      } finally {
        if (previousEmail === undefined) {
          delete process.env.ADMIN_EMAIL;
        } else {
          process.env.ADMIN_EMAIL = previousEmail;
        }
        if (previousPassword === undefined) {
          delete process.env.ADMIN_PASSWORD;
        } else {
          process.env.ADMIN_PASSWORD = previousPassword;
        }
      }
    });
  });
});

const bcryptCompare = async (hash) => {
  const { default: bcrypt } = await import("bcrypt");
  return bcrypt.compare("BootstrapPassw0rd!", hash);
};
