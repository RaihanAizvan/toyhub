import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import express from "express";
import expressLayouts from "express-ejs-layouts";
import path from "node:path";
import session from "express-session";
import { fileURLToPath } from "node:url";

import block from "../controllers/adminModules/block.js";
import usersController from "../controllers/adminModules/users.js";
import User from "../models/users.models.js";
import { injectCsrfFields } from "../utils/csrf.js";
import { applyTestEnv } from "./helpers/test-env.js";
import { canReachTestDatabase, withTestDatabase } from "./helpers/test-db.js";
import { createUser, objectId } from "./helpers/fixtures.js";

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
  app.set("layout", "./layouts/layout");
  app.use(expressLayouts);
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(
    session({
      name: "toyhub.sid",
      secret: "s".repeat(32),
      resave: false,
      saveUninitialized: true,
    }),
  );
  app.locals.injectCsrfFields = injectCsrfFields;
  app.locals.toast = null;
  app.locals.flashMessage = null;
  app.post("/admin/blockUser/:id", block.postBlock);
  app.get("/admin/users", usersController.getUserList);
  app.use((_req, res) => res.status(404).send("not found"));
  return app;
};

let server;
let baseUrl;
let reachable = false;

before(async () => {
  reachable = await canReachTestDatabase();
  if (!reachable) {
    return;
  }
  server = buildApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!server) {
    return;
  }
  await new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections?.();
  });
});

const whenReachable = (name, fn) =>
  it(name, async (t) => {
    if (!reachable) {
      return t.skip("no MongoDB on the test URI");
    }
    return withTestDatabase(fn);
  });

const blockUser = (id, action = "block") =>
  fetch(`${baseUrl}/admin/blockUser/${id}`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ action }).toString(),
  });

whenReachable("blocking an id that does not exist is a 404", async () => {
  const response = await blockUser(objectId());

  assert.equal(response.status, 404, "the old code answered as if the user existed");
});

whenReachable("a malformed id is a 404 before it reaches the query", async () => {
  const response = await blockUser("not-an-object-id");

  assert.equal(response.status, 404);
});

whenReachable("an existing user is blocked and sent back to the list", async () => {
  const user = await createUser({ name: "Blocked Person" });

  const response = await blockUser(user._id, "block");

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/admin/users");
  const stored = await User.findById(user._id).lean();
  assert.equal(stored.isBlocked, true);

  const unblocked = await blockUser(user._id, "unblock");
  assert.equal(unblocked.status, 302);
  assert.equal((await User.findById(user._id).lean()).isBlocked, false);
});

whenReachable("the user list renders a legacy row with no joined date or block flag", async () => {
  await User.collection.insertOne({
    name: "Legacy Person",
    email: "legacy.person@example.invalid",
    phone_number: "9000000001",
    password: "not-a-real-hash",
    verified: true,
    totalAmoutSpended: 0,
  });

  const response = await fetch(`${baseUrl}/admin/users`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /Legacy Person/);
  assert.match(html, /toggleBlockUser\('[0-9a-f]{24}', false\)/, "undefined is not valid JS");
  assert.doesNotMatch(html, /TypeError|Cannot read propert/);
});
