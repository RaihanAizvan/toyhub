import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import express from "express";
import expressLayouts from "express-ejs-layouts";
import path from "node:path";
import session from "express-session";
import { fileURLToPath } from "node:url";

import Cart from "../models/cart.models.js";
import Offer from "../models/offers.models.js";
import Product from "../models/product.models.js";
import { CSRF_HEADER_NAME, exposeCsrfToken, verifyCsrfRequest } from "../utils/csrf.js";
import {
  bestOfferFor,
  isOfferLive,
  offerDiscountForUnit,
  offersForCart,
  offersForProduct,
} from "../utils/offer-rules.js";
import { applyTestEnv } from "./helpers/test-env.js";
import {
  canReachTestDatabase,
  clearTestDatabase,
  connectTestDatabase,
  disconnectTestDatabase,
} from "./helpers/test-db.js";
import {
  createCart,
  createCategory,
  createOffer,
  createProduct,
  createUser,
} from "./helpers/fixtures.js";

applyTestEnv();

const { default: userMiddleware } = await import("../middlewares/userMiddleware.js");

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
      secret: "u".repeat(32),
      resave: false,
      saveUninitialized: true,
    }),
  );
  app.use(exposeCsrfToken);
  app.use(verifyCsrfRequest);

  app.use((req, res, next) => {
    if (req.headers["x-test-user"]) {
      req.session.user = { id: req.headers["x-test-user"], name: "Test" };
    }
    next();
  });

  // The pricing path: the same middleware the cart routes run.
  app.get("/priced-cart", userMiddleware.updateOfferDiscountInCart, async (req, res) => {
    const cart = await Cart.findOne({ user: req.session.user.id }).populate("items.product");
    if (!cart) {
      return res.json({ empty: true });
    }
    res.json({
      subtotal: cart.subtotal,
      discount: cart.discount,
      offerDiscount: cart.offerDiscount,
      total: cart.total,
      lines: cart.items.map((item) => ({
        name: item.product?.name,
        offerDiscount: item.offerDiscount,
      })),
    });
  });

  app.get("/cart-offers", userMiddleware.updateOfferDiscountInCart, async (req, res) => {
    const cart = await Cart.findOne({ user: req.session.user.id }).populate("items.product");
    const offers = await offersForCart(cart);
    res.json({ names: offers.map((offer) => offer.name) });
  });

  app.use((error, req, res, next) => {
    res.status(error.status || 500).json({ message: error.message });
  });

  return app;
};

const reachable = await canReachTestDatabase();

const describeWhenReachable = reachable ? describe : describe.skip;

describeWhenReachable("offer eligibility", () => {
  let server;
  let reachableNow;

  before(async () => {
    reachableNow = await connectTestDatabase();
    if (!reachableNow) {
      return;
    }
    const app = buildApp();
    await new Promise((resolve) => {
      server = app.listen(0, resolve);
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (reachableNow) {
      await disconnectTestDatabase();
    }
  });

  beforeEach(async () => {
    if (!reachableNow) {
      return;
    }
    await clearTestDatabase();
  });

  const get = (path, as) =>
    fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      headers: as ? { "x-test-user": String(as._id || as) } : {},
    });

  const cartFor = (user, product, quantity = 1, overrides = {}) =>
    createCart({
      user: user._id,
      items: [{ product: product._id, quantity, price: product.price, discountPrice: 0 }],
      appliedCoupon: null,
      couponDiscount: 0,
      ...overrides,
    });

  const now = new Date();
  const daysFromNow = (days) => new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  it("an offer for the whole shop reaches the cart even though it names nothing", async () => {
    const user = await createUser();
    const product = await createProduct({ price: 1000, stock: 10 });
    await cartFor(user, product, 2);

    // A whole-shop offer is stored with empty reference lists. Reading those
    // lists literally is how "applies to everything" became "applies to
    // nothing".
    const offer = await createOffer({ offerType: "all", offerPercentage: 10 });

    const response = await get("/priced-cart", user);
    assert.equal(response.status, 200);
    const body = await response.json();

    assert.equal(body.offerDiscount, 200, "two units at 10% off 1000");
    assert.equal(Number(body.total), 1800);
    assert.ok(offer);
  });

  it("an offer on one product reaches only that product", async () => {
    const user = await createUser();
    const category = await createCategory();
    const wanted = await createProduct({ price: 500, stock: 10, category: category._id });
    const other = await createProduct({ price: 500, stock: 10, category: category._id });
    await cartFor(user, wanted, 1);
    await createOffer({
      offerType: "product",
      offerPercentage: 20,
      applicableProducts: [wanted._id],
    });

    const body = await (await get("/priced-cart", user)).json();
    assert.equal(body.offerDiscount, 100);
    assert.equal(body.lines.length, 1);
    assert.ok(other);
  });

  it("an offer on a category reaches the products in it", async () => {
    const user = await createUser();
    const category = await createCategory();
    const inside = await createProduct({ price: 400, stock: 10, category: category._id });
    await cartFor(user, inside, 1);
    await createOffer({
      offerType: "category",
      offerPercentage: 25,
      applicableCategories: [category._id],
    });

    const body = await (await get("/priced-cart", user)).json();
    assert.equal(body.offerDiscount, 100, "a quarter of 400");
  });

  it("an expired offer takes nothing off", async () => {
    const user = await createUser();
    const product = await createProduct({ price: 800, stock: 10 });
    await cartFor(user, product, 1);
    await createOffer({
      offerType: "all",
      offerPercentage: 50,
      startDate: daysFromNow(-10),
      endDate: daysFromNow(-1),
    });

    const body = await (await get("/priced-cart", user)).json();
    assert.equal(body.offerDiscount, 0, "an offer that ended yesterday is not an offer");
    assert.equal(Number(body.total), 800);
  });

  it("an offer that has not started takes nothing off", async () => {
    const user = await createUser();
    const product = await createProduct({ price: 800, stock: 10 });
    await cartFor(user, product, 1);
    await createOffer({
      offerType: "all",
      offerPercentage: 50,
      startDate: daysFromNow(1),
      endDate: daysFromNow(10),
    });

    const body = await (await get("/priced-cart", user)).json();
    assert.equal(body.offerDiscount, 0);
  });

  it("a blocked offer takes nothing off", async () => {
    const user = await createUser();
    const product = await createProduct({ price: 800, stock: 10 });
    await cartFor(user, product, 1);
    await createOffer({ offerType: "all", offerPercentage: 50, isBlocked: true });

    const body = await (await get("/priced-cart", user)).json();
    assert.equal(body.offerDiscount, 0);
  });

  it("two live offers give the better one rather than both", async () => {
    const user = await createUser();
    const product = await createProduct({ price: 1000, stock: 10 });
    await cartFor(user, product, 1);
    await createOffer({ name: "Small", offerType: "all", offerPercentage: 10 });
    await createOffer({ name: "Large", offerType: "all", offerPercentage: 20 });

    // Adding them up made 30% off, and two 60% offers made a negative line.
    const body = await (await get("/priced-cart", user)).json();
    assert.equal(body.offerDiscount, 200, "the better of 10% and 20%");
    assert.equal(Number(body.total), 800);
  });

  it("a discount is never worth more than the thing it discounts", async () => {
    const product = await createProduct({ price: 100, stock: 1 });
    const offer = await createOffer({ offerType: "all", offerPercentage: 90 });

    assert.equal(offerDiscountForUnit(product, offer), 90);
    assert.equal(
      offerDiscountForUnit({ ...product.toObject(), price: 10 }, { offerPercentage: 100 }),
      10,
      "a line can never go below nothing",
    );
  });

  it("the same cart prices the same way twice when offers tie", async () => {
    const product = await createProduct({ price: 200, stock: 1 });
    const first = await createOffer({ name: "A", offerType: "all", offerPercentage: 20 });
    const second = await createOffer({ name: "B", offerType: "all", offerPercentage: 20 });

    const forwards = bestOfferFor(product, [first, second]);
    const backwards = bestOfferFor(product, [second, first]);
    assert.equal(String(forwards._id), String(backwards._id), "a tie is not a coin toss");
  });

  it("an offer naming an id that no longer exists reaches nothing", async () => {
    const user = await createUser();
    const product = await createProduct({ price: 300, stock: 10 });
    await cartFor(user, product, 1);
    await createOffer({
      offerType: "product",
      offerPercentage: 30,
      applicableProducts: ["507f1f77bcf86cd799439011"],
    });

    const body = await (await get("/priced-cart", user)).json();
    assert.equal(body.offerDiscount, 0, "an id that is not a product names nothing");
  });

  it("a product with no category is not reached by a category offer", async () => {
    const user = await createUser();
    const category = await createCategory();
    const product = await createProduct({ price: 300, stock: 10 });
    await cartFor(user, product, 1);
    await createOffer({
      offerType: "category",
      offerPercentage: 30,
      applicableCategories: [category._id],
    });

    const body = await (await get("/priced-cart", user)).json();
    assert.equal(body.offerDiscount, 0);
  });

  it("the product page is offered the same offers the cart is given", async () => {
    const product = await createProduct({ price: 1000, stock: 5 });
    const everywhere = await createOffer({ name: "Everywhere", offerType: "all", offerPercentage: 5 });
    await createOffer({ name: "Mine", offerType: "product", offerPercentage: 15, applicableProducts: [product._id] });
    await createOffer({ name: "Stale", offerType: "product", offerPercentage: 90, applicableProducts: [product._id], startDate: daysFromNow(-10), endDate: daysFromNow(-1) });

    const offers = await offersForProduct(product);
    const names = offers.map((offer) => offer.name).sort();

    // A whole-shop offer does apply here, and an expired one does not, and the
    // page is deciding neither for itself.
    assert.deepEqual(names, ["Everywhere", "Mine"], "the page shows what the cart would honour");
    assert.ok(everywhere);
  });

  it("the checkout page is not shown offers that apply to nothing in the cart", async () => {
    const user = await createUser();
    const category = await createCategory();
    const product = await createProduct({ price: 500, stock: 10, category: category._id });
    await cartFor(user, product, 1);
    await createOffer({ name: "Everywhere", offerType: "all", offerPercentage: 5 });
    await createOffer({ name: "ThisCategory", offerType: "category", offerPercentage: 10, applicableCategories: [category._id] });

    const body = await (await get("/cart-offers", user)).json();
    assert.deepEqual(body.names.sort(), ["Everywhere", "ThisCategory"]);
  });

  it("an empty cart is offered nothing rather than the whole shop", async () => {
    const user = await createUser();
    await createOffer({ name: "Everywhere", offerType: "all", offerPercentage: 5 });

    const body = await (await get("/cart-offers", user)).json();
    assert.deepEqual(body.names, [], "nothing to buy is nothing to offer");
  });

  it("an offer with no dates is live, because an unset date does not bound it", () => {
    assert.equal(isOfferLive({ offerPercentage: 10, isBlocked: false }), true);
    assert.equal(
      isOfferLive({ offerPercentage: 10, isBlocked: false, startDate: daysFromNow(1) }),
      false,
    );
    assert.equal(
      isOfferLive({ offerPercentage: 10, isBlocked: false, endDate: daysFromNow(-1) }),
      false,
    );
    assert.equal(isOfferLive({ offerPercentage: 10, isBlocked: true }), false);
  });

  it("the schema refuses a discount of more than the whole price", async () => {
    await assert.rejects(
      () => Offer.create({ name: "Too much", offerType: "all", offerPercentage: 140, startDate: daysFromNow(-1), endDate: daysFromNow(1) }),
      /offerPercentage/,
    );
    await assert.rejects(
      () => Offer.create({ name: "Backwards", offerType: "all", offerPercentage: 10, startDate: daysFromNow(1), endDate: daysFromNow(-1) }),
      /endDate/,
      "an offer that ends before it starts is not an offer",
    );
  });

  it("deleting an offer takes it off the products that listed it", async () => {
    const product = await createProduct({ price: 100, stock: 1 });
    const offer = await createOffer({ offerType: "product", offerPercentage: 10, applicableProducts: [product._id] });
    await Product.updateOne({ _id: product._id }, { $addToSet: { availableOffers: offer._id } });

    const { default: offerController } = await import("../controllers/adminModules/offer.js");
    let redirected = false;
    await offerController.deleteOffer(
      { params: { id: String(offer._id) } },
      { redirect: () => { redirected = true; }, status: () => ({ render: () => {} }) },
    );

    assert.equal(redirected, true);
    const after = await Product.findById(product._id);
    assert.deepEqual(after.availableOffers, [], "a product that lists a deleted offer renders one that does not exist");
  });

  it("an offer that names a product which does not exist is refused by the admin route", async () => {
    const { default: offerController } = await import("../controllers/adminModules/offer.js");
    let rendered = null;
    await offerController.postAddOffer(
      { body: { name: "Ghost", offerType: "product", offerPercentage: 10, startDate: daysFromNow(-1), endDate: daysFromNow(1), applicableProducts: ["507f1f77bcf86cd799439011"] } },
      { status: (code) => ({ render: (view, locals) => { rendered = { code, locals }; } }) },
    );

    assert.equal(rendered.code, 400);
    assert.match(rendered.locals.message, /does not exist/);
    assert.equal(await Offer.countDocuments({ name: "Ghost" }), 0, "nothing was stored");
  });

  it("an offer percentage over a hundred is refused by the admin route", async () => {
    const { default: offerController } = await import("../controllers/adminModules/offer.js");
    let rendered = null;
    await offerController.postAddOffer(
      { body: { name: "Half the shop twice", offerType: "all", offerPercentage: 140, startDate: daysFromNow(-1), endDate: daysFromNow(1) } },
      { status: (code) => ({ render: (view, locals) => { rendered = { code, locals }; } }) },
    );

    assert.equal(rendered.code, 400);
    assert.match(rendered.locals.message, /100/);
  });
});
