import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import express from "express";
import session from "express-session";
import path from "node:path";
import { fileURLToPath } from "node:url";

import adminRoute from "../routes/adminRoute.js";
import { applyTestEnv } from "./helpers/test-env.js";
import {
  canReachTestDatabase,
  withTestDatabase,
} from "./helpers/test-db.js";
import { createAdmin } from "./helpers/fixtures.js";

applyTestEnv();

const viewsDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "views",
);

const startServer = async (adminEmail) => {
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
  // Stand in for a completed admin login; isAdmin still re-checks the account.
  app.use((req, res, next) => {
    req.session.sAdminEmail = adminEmail;
    next();
  });
  app.use("/admin", adminRoute);

  const server = app.listen(0);
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

let reachable = false;

before(async () => {
  reachable = await canReachTestDatabase();
});

after(async () => {
  // Each test opens and closes the database around itself.
});

const whenReachable = (name, fn) =>
  it(name, async (t) => {
    if (!reachable) {
      return t.skip("no MongoDB on the test URI");
    }
    return withTestDatabase(fn);
  });

const getPaths = [
  "/admin/editProduct/not-an-id",
  "/admin/category/edit/not-an-id",
  "/admin/orders/view/not-an-id",
  "/admin/editCoupon/not-an-id",
  "/admin/editOffer/not-an-id",
];

const postPaths = [
  "/admin/blockProduct/not-an-id",
  "/admin/editProduct/not-an-id",
  "/admin/category/edit/not-an-id",
  "/admin/category/delete/not-an-id",
  "/admin/blockUser/not-an-id",
  "/admin/orders/updateStatus/not-an-id",
  "/admin/editCoupon/not-an-id",
  "/admin/deleteCoupon/not-an-id",
  "/admin/blockCoupon/not-an-id",
  "/admin/editOffer/not-an-id",
  "/admin/blockOffer/not-an-id",
  "/admin/deleteOffer/not-an-id",
];

whenReachable("an id that cannot be an ObjectId is 404 on every admin route", async () => {
  const admin = await createAdmin();
  const server = await startServer(admin.email);

  try {
    for (const path of getPaths) {
      const response = await fetch(`${server.baseUrl}${path}`, {
        redirect: "manual",
      });
      const body = await response.text();
      assert.equal(response.status, 404, `${path} should be 404`);
      assert.equal(body, "Not found", `${path} should not reach a handler`);
    }

    for (const path of postPaths) {
      const response = await fetch(`${server.baseUrl}${path}`, {
        method: "POST",
        redirect: "manual",
        headers: { accept: "application/json" },
        body: JSON.stringify({}),
      });
      const body = await response.json();
      assert.equal(response.status, 404, `${path} should be 404`);
      assert.equal(body.message, "Not found", `${path} should not reach a handler`);
    }
  } finally {
    await server.close();
  }
});
