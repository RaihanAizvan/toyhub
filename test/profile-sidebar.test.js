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
