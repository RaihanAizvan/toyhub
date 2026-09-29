import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import express from "express";
import expressLayouts from "express-ejs-layouts";
import path from "node:path";
import session from "express-session";
import { fileURLToPath } from "node:url";

import Cart from "../models/cart.models.js";
import Coupon from "../models/couponSchema.models.js";
import CouponRedemption from "../models/coupon-redemptions.models.js";
import Order from "../models/orders.models.js";
import Product from "../models/product.models.js";
import { CSRF_HEADER_NAME, exposeCsrfToken, injectCsrfFields, verifyCsrfRequest } from "../utils/csrf.js";
import { settleAppliedCoupon } from "../utils/coupon-rules.js";
import { applyTestEnv } from "./helpers/test-env.js";
import {
  canReachTestDatabase,
  clearTestDatabase,
  connectTestDatabase,
  disconnectTestDatabase,
} from "./helpers/test-db.js";
import {
  createAddress,
  createCart,
  createCategory,
  createCoupon,
  createCouponRedemption,
  createOrder,
  createProduct,
  createUser,
} from "./helpers/fixtures.js";

applyTestEnv();

const checkoutRouter = (await import("../routes/checkoutRoute.js")).default;

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

  app.use((req, res, next) => {
    res.locals.name = req.session.user?.name;
    res.locals.toast = req.session.toast;
    delete req.session.toast;
    next();
  });

  app.locals.injectCsrfFields = injectCsrfFields;
  app.use(exposeCsrfToken);
  app.use(verifyCsrfRequest);

  app.use((req, _res, next) => {
    const account = req.headers["x-test-user"];
    if (account) {
      req.session.user = { id: String(account), name: "Coupon Tester" };
    }
    next();
  });

  app.get("/test/session", (req, res) => {
    res.json({ user: req.session.user ?? null, token: req.session.csrfToken ?? null });
  });

  app.use("/checkout", checkoutRouter);

  return app;
};

const startServer = async () => {
  const server = buildApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections?.();
      }),
  };
};

const createClient = (server, account) => {
  let cookie = null;
  let token = null;

  const prime = async () => {
    const primed = await fetch(`${server.baseUrl}/test/session`, {
      headers: account ? { "x-test-user": String(account) } : {},
    });
    cookie = primed.headers.getSetCookie?.()[0]?.split(";")[0] ?? null;
    token = (await primed.json()).token ?? null;
  };

  return async (requestPath, { method = "POST", body, json } = {}) => {
    if (token === null) {
      await prime();
    }

    const response = await fetch(`${server.baseUrl}${requestPath}`, {
      method,
      redirect: "manual",
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(token ? { [CSRF_HEADER_NAME]: token } : {}),
        ...(account ? { "x-test-user": String(account) } : {}),
        ...(json
          ? { "content-type": "application/json" }
          : body
            ? { "content-type": "application/x-www-form-urlencoded" }
            : {}),
      },
      body: json ? JSON.stringify(json) : body ? new URLSearchParams(body).toString() : undefined,
    });

    const text = await response.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }

    return { status: response.status, text, data };
  };
};

const send = (server, requestPath, { method = "POST", as: account, body, json } = {}) =>
  createClient(server, account)(requestPath, { method, body, json });

const addressFields = (overrides = {}) => ({
  name: "Test Recipient",
  street: "1 Test Street",
  city: "Testville",
  state: "Teststate",
  zip: "400001",
  phone: "9000000000",
  ...overrides,
});

const cartFor = (user, product, quantity = 1, overrides = {}) =>
  createCart({
    user: user._id,
    items: [{ product: product._id, quantity, price: product.price, discountPrice: 0 }],
    ...overrides,
  });

const daysFromNow = (days) => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

const applyCode = (server, user, code, extra = {}) =>
  send(server, "/checkout/apply-coupon", {
    as: user._id,
    body: { couponCode: code, ...extra },
  });

describe("coupon rules", () => {
  let server;
  let reachable = false;
  let connection = null;

  before(async () => {
    reachable = await canReachTestDatabase();
    if (!reachable) {
      return;
    }
    connection = await connectTestDatabase();
    await clearTestDatabase();
    server = await startServer();
  });

  after(async () => {
    await server?.close();
    if (connection) {
      await clearTestDatabase();
      await disconnectTestDatabase();
    }
  });

  const itWhenReachable = (name, fn) =>
    it(name, async (t) => {
      if (!reachable) {
        return t.skip("no MongoDB on the test URI");
      }
      await clearTestDatabase();
      return fn(t);
    });

  itWhenReachable("a valid coupon is measured against the cart", async () => {
    const user = await createUser();
    const product = await createProduct({ price: 1000, discount: 0, stock: 10 });
    await cartFor(user, product, 2);
    const coupon = await createCoupon({ discount: 10, minSpend: 1000, usageLimit: 5 });

    const response = await applyCode(server, user, coupon.couponCode, { totalAmount: "100000" });

    assert.equal(response.status, 200);
    assert.equal(response.data.discountAmount, 200, "a tenth of the 2000 in the cart");

    const cart = await Cart.findOne({ user: user._id });
    assert.equal(cart.appliedCoupon, coupon.couponCode);
    assert.equal(Number(cart.couponDiscount), 200);
  });

  itWhenReachable("a code that is not the shop's is refused", async () => {
    const user = await createUser();
    const product = await createProduct({ price: 500, stock: 10 });
    await cartFor(user, product, 1);

    const response = await applyCode(server, user, "NOSUCHCODE");

    assert.equal(response.status, 400);
    assert.match(response.data.message, /not one of ours/i);
  });

  itWhenReachable("a code of the wrong shape is refused before it is looked up", async () => {
    const user = await createUser();
    const product = await createProduct({ price: 500, stock: 10 });
    await cartFor(user, product, 1);

    const response = await applyCode(server, user, "$$$");

    assert.equal(response.status, 400);
    assert.match(response.data.message, /not one of ours/i);
  });

  itWhenReachable("an expired coupon is refused", async () => {
    const user = await createUser();
    const product = await createProduct({ price: 500, stock: 10 });
    await cartFor(user, product, 2);
    const coupon = await createCoupon({
      startDate: daysFromNow(-30),
      endDate: daysFromNow(-1),
    });

    const response = await applyCode(server, user, coupon.couponCode);

    assert.equal(response.status, 400);
    assert.match(response.data.message, /expired/i);
  });

  itWhenReachable("a coupon that has not started yet is refused", async () => {
    const user = await createUser();
    const product = await createProduct({ price: 500, stock: 10 });
    await cartFor(user, product, 2);
    const coupon = await createCoupon({
      startDate: daysFromNow(1),
      endDate: daysFromNow(30),
    });

    const response = await applyCode(server, user, coupon.couponCode);

    assert.equal(response.status, 400);
    assert.match(response.data.message, /not available yet/i);
  });

  itWhenReachable("a used-up coupon is refused", async () => {
    const user = await createUser();
    const product = await createProduct({ price: 500, stock: 10 });
    await cartFor(user, product, 2);
    const coupon = await createCoupon({ usageLimit: 0 });

    const response = await applyCode(server, user, coupon.couponCode);

    assert.equal(response.status, 400);
    assert.match(response.data.message, /fully used/i);
  });

  itWhenReachable("a cart that does not reach the minimum is refused", async () => {
    const user = await createUser();
    const product = await createProduct({ price: 500, stock: 10 });
    await cartFor(user, product, 1);
    const coupon = await createCoupon({ minSpend: 5000 });

    const response = await applyCode(server, user, coupon.couponCode);

    assert.equal(response.status, 400);
    assert.match(response.data.message, /at least/i);

    const cart = await Cart.findOne({ user: user._id });
    assert.equal(cart.appliedCoupon, null, "the coupon was not applied");
  });

  itWhenReachable("a percentage coupon is capped at what the shop said", async () => {
    const user = await createUser();
    const product = await createProduct({ price: 1000, stock: 10 });
    await cartFor(user, product, 4);
    const coupon = await createCoupon({ discount: 50, maxDiscount: 300 });

    const response = await applyCode(server, user, coupon.couponCode);

    assert.equal(response.status, 200);
    assert.equal(response.data.discountAmount, 300, "50% of 4000, capped at 300");
  });

  itWhenReachable("a fixed coupon is never worth more than the cart", async () => {
    const user = await createUser();
    const product = await createProduct({ price: 200, stock: 10 });
    await cartFor(user, product, 1);
    const coupon = await createCoupon({ discount: 5000, discountType: "fixed" });

    const response = await applyCode(server, user, coupon.couponCode);

    assert.equal(response.status, 200);
    assert.equal(response.data.discountAmount, 200, "the whole cart, and no more");
  });

  itWhenReachable("a coupon limited to products is measured against those lines only", async () => {
    const user = await createUser();
    const wanted = await createProduct({ price: 1000, stock: 10 });
    const other = await createProduct({ price: 1000, stock: 10 });
    await createCart({
      user: user._id,
      items: [
        { product: wanted._id, quantity: 1, price: 1000, discountPrice: 0 },
        { product: other._id, quantity: 3, price: 1000, discountPrice: 0 },
      ],
    });
    const coupon = await createCoupon({
      discount: 50,
      applicableProducts: [wanted._id],
    });

    const response = await applyCode(server, user, coupon.couponCode);

    assert.equal(response.status, 200);
    assert.equal(response.data.discountAmount, 500, "half of the one matching line");
  });

  itWhenReachable("a coupon limited to products is refused on a cart without one", async () => {
    const user = await createUser();
    const wanted = await createProduct({ price: 1000, stock: 10 });
    const other = await createProduct({ price: 1000, stock: 10 });
    await cartFor(user, other, 1);
    const coupon = await createCoupon({ applicableProducts: [wanted._id] });

    const response = await applyCode(server, user, coupon.couponCode);

    assert.equal(response.status, 400);
    assert.match(response.data.message, /does not apply to anything/i);
  });

  itWhenReachable("a coupon limited to categories is measured against those lines", async () => {
    const user = await createUser();
    const category = await createCategory();
    const inside = await createProduct({ price: 800, category: category._id, stock: 10 });
    const outside = await createProduct({ price: 800, stock: 10 });
    await createCart({
      user: user._id,
      items: [
        { product: inside._id, quantity: 1, price: 800, discountPrice: 0 },
        { product: outside._id, quantity: 2, price: 800, discountPrice: 0 },
      ],
    });
    const coupon = await createCoupon({
      discount: 10,
      applicableCategories: [category._id],
    });

    const response = await applyCode(server, user, coupon.couponCode);

    assert.equal(response.status, 200);
    assert.equal(response.data.discountAmount, 80, "a tenth of the one matching line");
  });

  itWhenReachable("taking a coupon off leaves a total that can be paid", async () => {
    const user = await createUser();
    const product = await createProduct({ price: 1000, stock: 10 });
    await cartFor(user, product, 2);
    const coupon = await createCoupon({ discount: 10 });

    await applyCode(server, user, coupon.couponCode);
    const response = await send(server, "/checkout/remove-coupon", { as: user._id });

    assert.equal(response.status, 200);
    assert.equal(response.data.discountAmount, 0);
    assert.equal(response.data.totalAmount, 2000, "the price without the coupon");

    const cart = await Cart.findOne({ user: user._id });
    assert.equal(cart.appliedCoupon, null, "the cart no longer holds it");
    assert.equal(Number(cart.couponDiscount), 0);
  });

  itWhenReachable("the same code gives the same answer the second time", async () => {
    const user = await createUser();
    const product = await createProduct({ price: 1000, stock: 10 });
    await cartFor(user, product, 2);
    const coupon = await createCoupon({ discount: 10 });

    const first = await applyCode(server, user, coupon.couponCode);
    await send(server, "/checkout/remove-coupon", { as: user._id });
    const second = await applyCode(server, user, coupon.couponCode);

    assert.equal(first.data.discountAmount, second.data.discountAmount);
    assert.equal(first.data.totalAmount, second.data.totalAmount);
  });

  itWhenReachable("a coupon a shopper has already spent is refused", async () => {
    const user = await createUser();
    const product = await createProduct({ price: 1000, stock: 10 });
    const address = await createAddress({ user: user._id, ...addressFields() });
    const coupon = await createCoupon({ discount: 10, usageLimit: 50 });
    await cartFor(user, product, 1, { appliedCoupon: coupon.couponCode, couponDiscount: 100 });

    const first = await send(server, "/checkout", {
      as: user._id,
      body: { selectedAddress: String(address._id), paymentMethod: "cod" },
    });
    assert.equal(first.status, 200);

    const redemption = await CouponRedemption.findOne({ user: user._id });
    assert.ok(redemption, "the order spent the coupon");
    assert.equal(redemption.couponCode, coupon.couponCode);

    // The same account, a second cart, the same code.
    await cartFor(user, product, 1);
    const response = await applyCode(server, user, coupon.couponCode);

    assert.equal(response.status, 400);
    assert.match(response.data.message, /already used/i);
  });

  itWhenReachable("an order takes one use off the coupon", async () => {
    const user = await createUser();
    const product = await createProduct({ price: 500, stock: 10 });
    const address = await createAddress({ user: user._id, ...addressFields() });
    const coupon = await createCoupon({ usageLimit: 3 });
    await cartFor(user, product, 1, { appliedCoupon: coupon.couponCode, couponDiscount: 50 });

    await send(server, "/checkout", {
      as: user._id,
      body: { selectedAddress: String(address._id), paymentMethod: "cod" },
    });

    const after = await Coupon.findById(coupon._id);
    assert.equal(after.usageLimit, 2, "one of the three uses went");
    assert.equal(after.timesUsed, 1);
  });

  itWhenReachable("repeating the request that placed an order does not spend the coupon twice", async () => {
    const user = await createUser();
    const product = await createProduct({ price: 500, stock: 10 });
    const address = await createAddress({ user: user._id, ...addressFields() });
    const coupon = await createCoupon({ usageLimit: 3 });
    await cartFor(user, product, 1, { appliedCoupon: coupon.couponCode, couponDiscount: 50 });

    const body = {
      selectedAddress: String(address._id),
      paymentMethod: "cod",
      checkoutKey: "attempt-one",
    };

    const first = await send(server, "/checkout", { as: user._id, body });
    assert.equal(first.status, 200);

    // The cart is gone, so the replay has to be refused for its own reason
    // rather than reaching the coupon.
    await cartFor(user, product, 1);
    const replay = await send(server, "/checkout", { as: user._id, body });

    assert.equal(replay.status, 200);
    assert.equal(replay.data.repeated, true, "the same attempt, not a second order");

    const after = await Coupon.findById(coupon._id);
    assert.equal(after.usageLimit, 2, "the replay spent nothing");
    assert.equal(await CouponRedemption.countDocuments({ coupon: coupon._id }), 1);
    assert.equal(await Order.countDocuments({ user: user._id }), 1);
  });

  itWhenReachable("an order carrying a coupon is refused if the last use went elsewhere", async () => {
    const user = await createUser();
    const product = await createProduct({ price: 500, stock: 10 });
    const address = await createAddress({ user: user._id, ...addressFields() });
    const coupon = await createCoupon({ usageLimit: 1 });
    await cartFor(user, product, 1, { appliedCoupon: coupon.couponCode, couponDiscount: 50 });

    // Somebody else takes the last use while this cart is being checked out.
    const other = await createUser();
    const otherOrder = await createOrder({ user: other._id, paid: true });
    await createCouponRedemption({
      coupon: coupon._id,
      couponCode: coupon.couponCode,
      user: other._id,
      order: otherOrder._id,
      amount: 10,
    });
    await Coupon.updateOne({ _id: coupon._id }, { $inc: { usageLimit: -1 } });

    const response = await send(server, "/checkout", {
      as: user._id,
      body: { selectedAddress: String(address._id), paymentMethod: "cod" },
    });

    // The coupon is used up by the time the order is priced, so it comes off
    // and the shopper pays the full price rather than a discount nobody can
    // honour.
    assert.equal(response.status, 200);
    const order = await Order.findById(response.data.orderId);
    assert.equal(Number(order.couponDiscount), 0);
    assert.equal(Number(order.totalAmount), 500);
  });

  itWhenReachable("a coupon that has since been blocked stops being applied at checkout", async () => {
    const user = await createUser();
    const product = await createProduct({ price: 500, stock: 10 });
    const address = await createAddress({ user: user._id, ...addressFields() });
    await cartFor(user, product, 2, { appliedCoupon: "GONE", couponDiscount: 500 });
    await createCoupon({ couponCode: "GONE", usageLimit: 5, isBlocked: true });

    const response = await send(server, "/checkout", {
      as: user._id,
      body: { selectedAddress: String(address._id), paymentMethod: "cod" },
    });

    assert.equal(response.status, 200);
    const order = await Order.findById(response.data.orderId);
    assert.equal(Number(order.couponDiscount), 0, "the coupon was dropped");
    assert.equal(Number(order.totalAmount), 1000);
  });

  itWhenReachable("a stored discount that no longer matches the cart is worked out again", async () => {
    const user = await createUser();
    const product = await createProduct({ price: 1000, stock: 10 });
    const address = await createAddress({ user: user._id, ...addressFields() });
    const coupon = await createCoupon({ discount: 10 });

    // The cart says it saved 900, which is not what 10% of 2000 is.
    await cartFor(user, product, 2, {
      appliedCoupon: coupon.couponCode,
      couponDiscount: 900,
    });

    const response = await send(server, "/checkout", {
      as: user._id,
      body: { selectedAddress: String(address._id), paymentMethod: "cod" },
    });

    assert.equal(response.status, 200);
    const order = await Order.findById(response.data.orderId);
    assert.equal(Number(order.couponDiscount), 200, "the shop's own arithmetic");
    assert.equal(Number(order.totalAmount), 1800);
  });

  itWhenReachable("a coupon cannot be applied to a cart carrying a cutoff", async () => {
    const user = await createUser();
    const product = await createProduct({ price: 100, stock: 10 });
    await cartFor(user, product, 1);
    const coupon = await createCoupon({ discount: 10 });

    // The cutoff is what the shop keeps for a small cart, so a discount on top
    // of it would land below the floor.
    const response = await applyCode(server, user, coupon.couponCode);
    assert.equal(response.status, 200, "a 100 cart carries no cutoff of its own");

    // The cutoff is what the shop keeps for a small cart, so a discount on top
    // of it would land below the floor. The coupon is taken off rather than
    // honoured, and the reason says why.
    await Cart.updateOne({ user: user._id }, { $set: { cutoffAmount: 25 } });
    const cart = await Cart.findOne({ user: user._id }).populate("items.product");
    const settled = await settleAppliedCoupon(cart, { userId: user._id });

    assert.equal(settled.dropped, true);
    assert.match(settled.reason, /cutoff/i);
    assert.equal(cart.appliedCoupon, null, "a cutoff and a coupon are not both on one cart");
  });

  itWhenReachable("a code with spaces or the wrong case is the same code", async () => {
    const user = await createUser();
    const product = await createProduct({ price: 1000, stock: 10 });
    await cartFor(user, product, 2);
    const coupon = await createCoupon({ couponCode: "SAVE20", discount: 20 });

    const response = await applyCode(server, user, "  save20  ");

    assert.equal(response.status, 200);
    assert.equal(response.data.discountAmount, 400);

    const cart = await Cart.findOne({ user: user._id });
    assert.equal(cart.appliedCoupon, "SAVE20", "stored the way the shop wrote it");
  });
});
