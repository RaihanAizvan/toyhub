import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, it } from "node:test";
import express from "express";
import expressLayouts from "express-ejs-layouts";
import session from "express-session";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pagesRoutes from "../routes/pagesRoute.js";
import { injectCsrfFields } from "../utils/csrf.js";
import { applyTestEnv } from "./helpers/test-env.js";
import {
  canReachTestDatabase,
  withTestDatabase,
} from "./helpers/test-db.js";
import { createCategory } from "./helpers/fixtures.js";

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
  app.use(
    session({
      name: "toyhub.sid",
      secret: "p".repeat(32),
      resave: false,
      saveUninitialized: true,
    }),
  );
  app.locals.injectCsrfFields = injectCsrfFields;
  app.use((req, res, next) => {
    res.locals.csrfToken = "test-csrf-token";
    res.locals.toast = null;
    res.locals.flashMessage = null;
    next();
  });
  app.use("/", pagesRoutes);
  app.use((req, res) => res.status(404).send("not found"));
  return app;
};

let server;
let reachable = false;
let baseUrl;

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
  if (server) {
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections?.();
    });
  }
});

const whenReachable = (name, fn) =>
  it(name, async (t) => {
    if (!reachable) {
      return t.skip("no MongoDB on the test URI");
    }
    return withTestDatabase(fn);
  });

const get = async (path) => {
  const response = await fetch(`${baseUrl}${path}`, { redirect: "manual" });
  return { status: response.status, text: await response.text() };
};

it("the server mounts the pages router", () => {
  const source = readFileSync(new URL("../server.js", import.meta.url), "utf8");
  assert.match(source, /app\.use\("\/", pagesRoutes\)/);
});

whenReachable("the about page explains the shop and links to it", async () => {
  await createCategory({ name: "Robots" });

  const page = await get("/about");

  assert.equal(page.status, 200);
  assert.match(page.text, /About ToyHub/);
  assert.match(page.text, /Browse the shop/);
  assert.match(page.text, /href="\/product"/);
  assert.match(page.text, /href="\/contact"/);
  assert.match(page.text, /href="\/privacy"/);
  assert.match(page.text, /Robots/, "the header still offers the live categories");
});

whenReachable("the contact page gives real destinations", async () => {
  const page = await get("/contact");

  assert.equal(page.status, 200);
  assert.match(page.text, /mailto:toyhub@gmail\.com/);
  assert.match(page.text, /tel:\+916238880997/);
  assert.match(page.text, /href="\/account\/orders"/);
  assert.match(page.text, /href="\/about"/);
});

whenReachable("the privacy page says what is stored and how to ask", async () => {
  const page = await get("/privacy");

  assert.equal(page.status, 200);
  assert.match(page.text, /What ToyHub keeps/);
  assert.match(page.text, /session cookie/i);
  assert.match(page.text, /mailto:toyhub@gmail\.com/);
  assert.match(page.text, /href="\/about"/);
});

whenReachable("the page routes are not open to unknown paths", async () => {
  const page = await get("/an-about-page-that-does-not-exist");

  assert.equal(page.status, 404);
});
