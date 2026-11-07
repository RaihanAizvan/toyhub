import assert from "node:assert/strict";
import path from "node:path";
import { it } from "node:test";
import { fileURLToPath } from "node:url";
import ejs from "ejs";

const view = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "views",
  "user",
  "profile-sidebar.ejs",
);

it("every My Orders entry opens the mounted /account/orders route", async () => {
  const html = await ejs.renderFile(view, {
    name: "Test User",
    title: "Profile Edit",
    categories: [],
  });

  assert.doesNotMatch(html, /href="\/orders"/);
  assert.equal((html.match(/href="\/account\/orders"/g) || []).length, 4);
});

it("every static account link in the sidebar has a route", async () => {
  const html = await ejs.renderFile(view, {
    name: "Test User",
    title: "Profile Edit",
    categories: [],
  });
  const { readFileSync } = await import("node:fs");
  const routesSource = readFileSync(
    new URL("../routes/profileRoutes.js", import.meta.url),
    "utf8",
  );
  const routes = new Set(
    [...routesSource.matchAll(/router\.(?:get|post|delete)\(\s*['"]([^'"]+)['"]/g)].map(
      (match) => match[1],
    ),
  );
  const hrefs = new Set(
    [...html.matchAll(/href="(\/account(?:\/[^"<]*)?)"/g)].map((match) => match[1]),
  );

  assert.ok(hrefs.size > 0, "the sidebar should link into the account area");
  for (const href of hrefs) {
    const route = href === "/account" ? "/" : href.slice("/account".length);
    assert.ok(routes.has(route), `${href} has no matching route`);
  }
});
