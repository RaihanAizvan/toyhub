import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

it("the stylesheet respects a reduced-motion preference", () => {
  const css = read("public/css/styles.css");

  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /animation-iteration-count: 1 !important/);
  assert.match(css, /scroll-behavior: auto !important/);
});

it("keyboard focus stays visible outside Tailwind utilities", () => {
  const css = read("public/css/styles.css");

  assert.match(css, /:focus-visible/);
  assert.match(css, /outline: 2px solid #19D16F/);
});

it("the header loads one icon set and names every icon-only control", () => {
  const header = read("views/user/header.ejs");

  assert.doesNotMatch(header, /font-awesome\/6\./);
  assert.match(header, /aria-label="Search products"/);
  assert.match(header, /aria-label="Search"/);
  assert.match(header, /aria-label="Toggle search"/);
  assert.match(header, /aria-label="Toggle menu"/);
  assert.match(header, /aria-label="Log out"/);
});

it("the profile menu button has a name", () => {
  const sidebar = read("views/user/profile-sidebar.ejs");

  assert.match(sidebar, /aria-label="Toggle account menu"/);
});

it("decorative animations are finite or removed", () => {
  const wallet = read("views/user/wallet.ejs");
  const coupon = read("views/user/coupon-show.ejs");
  const product = read("views/user/singleProduct.ejs");

  assert.doesNotMatch(wallet, /animation: glance .*infinite/);
  assert.doesNotMatch(coupon, /animate-spin-slow/);
  assert.doesNotMatch(coupon, /animate-bounce-slow/);
  assert.doesNotMatch(product, /border-glow/);
});
