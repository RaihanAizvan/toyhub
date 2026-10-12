import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import express from "express";
import expressLayouts from "express-ejs-layouts";
import path from "node:path";
import session from "express-session";
import { fileURLToPath } from "node:url";

import productRouter from "../routes/productRoute.js";
import { createCategory, createProduct } from "./helpers/fixtures.js";
import { injectCsrfFields } from "../utils/csrf.js";
import { applyTestEnv } from "./helpers/test-env.js";
import {
  canReachTestDatabase,
  clearTestDatabase,
  connectTestDatabase,
  disconnectTestDatabase,
} from "./helpers/test-db.js";

applyTestEnv();

const viewsDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "views",
);

let server;
let baseUrl;
let reachable = false;

before(async () => {
  reachable = await canReachTestDatabase();
  if (!reachable) {
    return;
  }
  await connectTestDatabase();

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
      secret: "r".repeat(32),
      resave: false,
      saveUninitialized: true,
    }),
  );
  app.use((req, res, next) => {
    res.locals.csrfToken = "test-csrf-token";
    res.locals.injectCsrfFields = injectCsrfFields;
    res.locals.user = null;
    res.locals.path = req.path;
    if (req.headers["x-test-user"]) {
      req.session.user = { id: req.headers["x-test-user"], name: "Route Prober" };
    }
    next();
  });

  app.use("/product", productRouter);

  app.use((req, res) => res.status(404).send("not found"));
  app.use((error, _req, res, _next) => {
    console.error("TEST PAGE ERROR:", error?.message);
    res.status(500).send("not found");
  });

  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => {
    if (!server) {
      return resolve();
    }
    server.close(resolve);
    server.closeAllConnections?.();
  });
  await disconnectTestDatabase();
});

beforeEach(async () => {
  if (!reachable) {
    return;
  }
  await clearTestDatabase();
});

const whenReachable = (name, fn) =>
  it(name, async (t) => {
    if (!reachable) {
      return t.skip("no MongoDB on the test URI");
    }
    return fn(t);
  });

describe("the product route registers its static addresses first", () => {
  whenReachable("a request for /product/categories reaches the category list", async () => {
    await createCategory({ name: "Building Blocks" });

    const response = await fetch(`${baseUrl}/product/categories`, {
      redirect: "manual",
    });

    assert.equal(response.status, 200, "the static address is not a product lookup");
    const body = await response.text();
    assert.match(body, /Building Blocks/);
    assert.doesNotMatch(body, /Redirecting/);
  });

  whenReachable("an id that is not an ObjectId answers with a defined not-found", async () => {
    const response = await fetch(`${baseUrl}/product/not-an-id`, {
      redirect: "manual",
    });

    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/");
  });

  whenReachable("a real product id still renders the product page", async () => {
    const category = await createCategory({ name: "Robots" });
    const product = await createProduct({
      name: "Tiny Rover",
      category: category._id,
      price: 800,
    });

    const response = await fetch(`${baseUrl}/product/${product._id}`, {
      redirect: "manual",
    });

    assert.equal(response.status, 200);
    const body = await response.text();
    assert.match(body, /Tiny Rover/);
  });

  whenReachable("a review for a missing product is a defined answer, not a crash", async () => {
    const response = await fetch(`${baseUrl}/product/not-an-id/review`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-test-user": "64b0000000000000000000aa",
      },
      body: JSON.stringify({ rating: 5 }),
    });

    assert.equal(response.status, 404);
    assert.ok((await response.json()).message);
  });

  whenReachable("an anonymous reviewer is told to sign in before anything else", async () => {
    const response = await fetch(`${baseUrl}/product/not-an-id/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rating: 5 }),
    });

    assert.equal(response.status, 401);
  });

  whenReachable("an unknown product page, not of this route, 404s cleanly", async () => {
    const response = await fetch(`${baseUrl}/product/`, { redirect: "manual" });
    assert.equal(response.status, 404);
  });
});