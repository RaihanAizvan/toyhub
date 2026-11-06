import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import express from "express";
import session from "express-session";
import path from "node:path";
import { fileURLToPath } from "node:url";

import checkoutRoutes from "../routes/checkoutRoute.js";
import profileRoutes from "../routes/profileRoutes.js";
import { applyTestEnv } from "./helpers/test-env.js";
import {
  canReachTestDatabase,
  withTestDatabase,
} from "./helpers/test-db.js";
import { createUser } from "./helpers/fixtures.js";

applyTestEnv();

const viewsDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "views",
);

const startServer = async (userId) => {
  const app = express();
  app.set("views", viewsDirectory);
  app.set("view engine", "ejs");
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(
    session({
      name: "toyhub.sid",
      secret: "b".repeat(32),
      resave: false,
      saveUninitialized: true,
    }),
  );
  // Stand in for a session that was opened before the account was blocked.
  app.use((req, res, next) => {
    req.session.user = { id: String(userId), name: "Blocked User" };
    next();
  });
  app.use("/account", profileRoutes);
  app.use("/checkout", checkoutRoutes);
  app.use((req, res) => res.status(599).send("reached no handler"));

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

whenReachable("a blocked account is turned away from every authenticated page", async () => {
  const user = await createUser({ name: "Blocked User", isBlocked: true });
  const server = await startServer(user._id);

  try {
    for (const [method, path] of [
      ["GET", "/account"],
      ["GET", "/account/address"],
      ["GET", "/account/orders"],
      ["GET", "/account/wishlist"],
      ["GET", "/account/wallet"],
      ["GET", "/account/reviews"],
      ["GET", "/checkout"],
    ]) {
      const response = await fetch(`${server.baseUrl}${path}`, {
        method,
        redirect: "manual",
      });
      assert.equal(response.status, 302, `${method} ${path} should redirect`);
      assert.equal(
        response.headers.get("location"),
        "/user/login?blocked=1",
        `${method} ${path} should say why`,
      );
      assert.match(
        response.headers.get("set-cookie") ?? "",
        /toyhub\.sid=;/,
        `${method} ${path} should clear the session cookie`,
      );
    }
  } finally {
    await server.close();
  }
});

whenReachable("a blocked account asking for json gets a json refusal", async () => {
  const user = await createUser({ name: "Blocked User", isBlocked: true });
  const server = await startServer(user._id);

  try {
    for (const [method, path] of [
      ["DELETE", "/account/wishlist"],
      ["POST", "/checkout/create-razorpay-order"],
      ["POST", "/checkout/wallet"],
    ]) {
      const response = await fetch(`${server.baseUrl}${path}`, {
        method,
        redirect: "manual",
        headers: { accept: "application/json" },
      });
      assert.equal(response.status, 403, `${method} ${path} should be refused`);
      assert.match(
        response.headers.get("content-type") ?? "",
        /application\/json/,
        `${method} ${path} should answer in json`,
      );
      const body = await response.json();
      assert.equal(body.success, false);
      assert.match(body.message, /blocked/i);
    }
  } finally {
    await server.close();
  }
});
