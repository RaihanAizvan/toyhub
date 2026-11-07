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
  "footer.ejs",
);

it("the app badges do not pretend to link to a store", async () => {
  const html = await ejs.renderFile(view, {});

  assert.doesNotMatch(html, /<a[^>]*>\s*<span>Download on App Store<\/span>/);
  assert.doesNotMatch(html, /<a[^>]*>\s*<span>Get it on Google Play<\/span>/);
  assert.equal((html.match(/coming soon/g) || []).length, 2);
  assert.equal((html.match(/title="Coming soon"/g) || []).length, 2);
});
