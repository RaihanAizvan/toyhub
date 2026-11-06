import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import ejs from "ejs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

it("the profile mobile menu is bound to its own button", () => {
  const sidebar = read("../views/user/profile-sidebar.ejs");

  assert.match(sidebar, /id="profileMenuButton"/);
  assert.match(sidebar, /getElementById\('profileMenuButton'\)/);
  assert.doesNotMatch(
    sidebar,
    /document\.querySelector\('button'\)/,
    "the first button on the page is not necessarily this menu's",
  );
});

it("the footer shows the current year", () => {
  const footer = ejs.render(read("../views/user/footer.ejs"), {});

  assert.match(footer, new RegExp(`© ${new Date().getFullYear()} `));
  assert.doesNotMatch(footer, /© 2024/);
});
