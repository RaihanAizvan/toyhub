import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import express from "express";
import expressLayouts from "express-ejs-layouts";
import session from "express-session";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { injectCsrfFields } from "../utils/csrf.js";

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
      secret: "n".repeat(32),
      resave: false,
      saveUninitialized: true,
    }),
  );
  app.locals.injectCsrfFields = injectCsrfFields;
  app.use((req, res, next) => {
    res.locals.csrfToken = "test-csrf-token";
    res.locals.toast = null;
    res.locals.flashMessage = null;
    res.locals.name = undefined;
    res.locals.categories = [];
    next();
  });
  app.use((req, res) => {
    res.status(404).render("404", { title: "Page not found" });
  });
  return app;
};

let server;
let baseUrl;

before(async () => {
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

it("an unknown URL explains itself and offers a way back", async () => {
  const response = await fetch(`${baseUrl}/nothing-here`);
  const text = await response.text();

  assert.equal(response.status, 404);
  assert.match(text, /<title>\s*Page not found\s*<\/title>/);
  assert.match(text, /<h1[^>]*>Page not found<\/h1>/);
  assert.match(text, /href="\/"/);
  assert.match(text, /href="\/product"/);
});

it("the 404 page is valid body content and loads no missing library", async () => {
  const response = await fetch(`${baseUrl}/nothing-here`);
  const text = await response.text();

  assert.equal((text.match(/<body\b/gi) || []).length, 1);
  assert.equal((text.match(/<\/body>/gi) || []).length, 1);
  assert.doesNotMatch(text, /codepen/i);
  assert.doesNotMatch(text, /anime\(/);
});

it("the server gives the 404 view a title", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../server.js", import.meta.url), "utf8");

  assert.match(source, /render\('404', \{ title: 'Page not found' \}\)/);
});
