import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const view = async (name) =>
  (await readFile(new URL(`../views/${name}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");

describe("navigation links", () => {
  it("the account sidebar points at pages that exist", async () => {
    const sidebar = await view("user/profile-sidebar.ejs");

    assert.match(sidebar, /href="\/account\/orders"/);
    assert.doesNotMatch(sidebar, /href="\/orders"/, "there is no /orders route");
    assert.doesNotMatch(sidebar, /\/account\/card-details/, "card details were never built");
    assert.doesNotMatch(sidebar, /\/account\/coupons/, "there is no account coupons page");
    assert.match(sidebar, /href="\/#coupons"/, "the coupons the shop does have are on the home page");
  });

  it("empty states lead to the real catalogue", async () => {
    const wishlist = await view("user/wishlist.ejs");
    assert.doesNotMatch(wishlist, /href="\/products"/, "there is no /products route");
    assert.match(wishlist, /href="\/product"/);

    const category = await view("user/categoryProducts.ejs");
    assert.doesNotMatch(category, /href="\/categories"/, "the listing lives at /categories/all");
    assert.match(category, /href="\/categories\/all"/);
  });

  it("the footer account column is wired to real pages", async () => {
    const footer = await view("user/footer.ejs");

    assert.match(footer, /href="\/user\/login"[^>]*>Sign In</);
    assert.match(footer, /href="\/cart"[^>]*>View Cart</);
    assert.match(footer, /href="\/account\/orders"[^>]*>My Orders</);
  });

  it("the shop links point at the product listing", async () => {
    const header = await view("user/header.ejs");
    assert.match(header, /href="\/product"[^>]*>\s*Shop\s*</);

    const bestSells = await view("user/best-sells.ejs");
    assert.match(bestSells, /href="\/product"[^>]*>Shop Now</);
  });

  it("the landing and login navigation reach the home page and its sections", async () => {
    for (const file of ["user/header-landing.ejs", "user/header-login.ejs"]) {
      const header = await view(file);
      assert.match(header, /href="\/"[^>]*>\s*Home\s*</);
      assert.match(header, /href="\/#best-sells"/);
      assert.match(header, /href="\/#offers"/);
    }
  });

  it("the anchors the navigation uses exist on the home page", async () => {
    assert.match(await view("user/best-sells.ejs"), /id="best-sells"/);
    assert.match(await view("user/offer-products.ejs"), /id="offers"/);
    assert.match(await view("user/coupon-show.ejs"), /id="coupons"/);
  });

  it("the admin coupon pages do not link to a banner page that never existed", async () => {
    for (const file of ["admin/couponList.ejs", "admin/editCoupon.ejs"]) {
      assert.doesNotMatch(await view(file), /\/admin\/banner/);
    }
  });

  it("the login page spells the signup route the way the router does", async () => {
    const login = await view("user/login.ejs");
    assert.doesNotMatch(login, /href="\/user\/Signup"/);
    assert.match(login, /href="\/user\/signup"/);
  });
});
