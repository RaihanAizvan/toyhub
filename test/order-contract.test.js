import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import express from "express";
import expressLayouts from "express-ejs-layouts";
import path from "node:path";
import session from "express-session";
import { fileURLToPath } from "node:url";

import Order, { ORDER_STATUSES, PAYMENT_METHODS, normaliseOrderStatus } from "../models/orders.models.js";
import Cart from "../models/cart.models.js";
import Product from "../models/product.models.js";
import User from "../models/users.models.js";
import { buildOrder } from "../utils/checkout.js";
import { CSRF_HEADER_NAME, exposeCsrfToken, injectCsrfFields, verifyCsrfRequest } from "../utils/csrf.js";
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
  createOrder,
  createProduct,
  createUser,
} from "./helpers/fixtures.js";

applyTestEnv();

const profile = await import("../controllers/userModules/profile.js");
const { default: adminOrderController } = await import("../controllers/adminModules/order.js");

// A delivery address as the checkout form sends it.
const addressFields = (overrides = {}) => ({
  name: "Raihan Aizvan",
  street: "12 Nabinagar",
  city: "Dhaka",
  state: "Dhaka",
  zip: "1212",
  phone: "01711111111",
  ...overrides,
});

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

  app.use((req, res, next) => {
    if (req.headers["x-test-user"]) {
      req.session.user = { id: req.headers["x-test-user"], name: "Test" };
    }
    next();
  });

  // The four places an order is read, wired to the four places it is written.
  app.get("/test/session", (req, res) => {
    res.json({ user: req.session.user ?? null, token: req.session.csrfToken ?? null });
  });

  app.get("/account/orders", profile.getOrderHistory);
  app.get("/account/orders/:id", profile.getOrderDetail);
  app.post("/account/orders/:id/cancel-reason", profile.postOrderCancel);
  app.post("/account/orders/:orderId/cancel-item", profile.postItemCancel);
  app.post("/account/orders/invoice/:orderId", profile.postDownloadInvoice);
  app.get("/admin/orders", adminOrderController.getAdminOrders);
  app.get("/admin/orders/:orderId", adminOrderController.getAdminOrderDetails);
  app.post("/admin/orders/:id/status", adminOrderController.postUpdateOrderStatus);

  app.use((error, req, res, next) => {
    res.status(error.status || 500).json({ message: error.message });
  });

  return app;
};

const reachable = await canReachTestDatabase();
const describeWhenReachable = reachable ? describe : describe.skip;

describeWhenReachable("order contract", () => {
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
    if (reachableNow) {
      await clearTestDatabase();
    }
  });

  // The application checks the session and the CSRF token on anything that
  // changes state, so the test talks to it the way a browser would.
  const clientFor = (account) => {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    let cookie = null;
    let token = null;

    const prime = async () => {
      const primed = await fetch(`${baseUrl}/test/session`, {
        headers: account ? { "x-test-user": account } : {},
      });
      cookie = primed.headers.getSetCookie?.()[0]?.split(";")[0] ?? null;
      token = (await primed.json()).token ?? null;
    };

    return async (requestPath, { method = "GET", json, body } = {}) => {
      if (token === null) {
        await prime();
      }

      return fetch(`${baseUrl}${requestPath}`, {
        method,
        redirect: "manual",
        headers: {
          ...(cookie ? { cookie } : {}),
          ...(token ? { [CSRF_HEADER_NAME]: token } : {}),
          ...(account ? { "x-test-user": account } : {}),
          ...(json
            ? { "content-type": "application/json" }
            : body
              ? { "content-type": "application/x-www-form-urlencoded" }
              : {}),
        },
        body: json ? JSON.stringify(json) : body ? new URLSearchParams(body).toString() : undefined,
      });
    };
  };

  const as = (account) => clientFor(account ? String(account._id || account) : null);
  const get = (path, account) => as(account)(path);
  const post = (path, account, options) => as(account)(path, { method: "POST", ...options });

  // A key per attempt, because the key is what makes a repeated attempt one
  // order rather than two.
  let orderCount = 0;

  // One order, placed the way checkout places it, with everything the pages read
  // already on the cart.
  const placeOrder = async ({ user, product, quantity = 2, address, coupon = null } = {}) => {
    // An account has one cart, so placing a second order starts from an empty
    // one the way a shopper who checked out would.
    await Cart.deleteMany({ user: user._id });
    orderCount += 1;

    const cart = await createCart({
      user: user._id,
      items: [{ product: product._id, quantity, price: product.price, discountPrice: 0 }],
      appliedCoupon: coupon,
      couponDiscount: coupon ? 100 : 0,
      offerDiscount: 0,
      discount: 0,
      subtotal: product.price * quantity,
      total: product.price * quantity - (coupon ? 100 : 0),
    });

    return Order.create(
      buildOrder({
        user,
        cart,
        lines: [{ product, quantity }],
        address,
        paymentMethod: "cod",
        paid: true,
        checkoutKey: `key-${orderCount}`,
      }),
    );
  };

  const scenario = async () => {
    const user = await createUser();
    const category = await createCategory();
    const product = await createProduct({ name: "Wooden Robot", price: 500, stock: 10, category: category._id });
    const address = await createAddress({ user: user._id, ...addressFields() });
    return { user, product, address };
  };

  it("an order placed at checkout reads back the same way everywhere", async () => {
    const { user, product, address } = await scenario();
    const order = await placeOrder({ user, product, address, coupon: "ROBOT10" });

    // What checkout wrote.
    assert.equal(order.address.name, address.name);
    assert.equal(order.address.phone, address.phone, "a phone number is kept as text");
    assert.equal(order.couponCode, "ROBOT10", "the code that paid is on the order");
    assert.equal(order.paymentMethod, "cod");
    assert.equal(order.totalAmount, 900);
    assert.equal(order.paid, true);
    assert.equal(order.status, "pending");

    // What the pages read.
    const history = await (await get("/account/orders", user)).text();
    assert.match(history, /Wooden Robot/);

    const detail = await get(`/account/orders/${order._id}`, user);
    assert.equal(detail.status, 200);
    const page = await detail.text();
    assert.match(page, new RegExp(user.email), "the buyer is read from the account");
    assert.match(page, /Wooden Robot/);
    assert.match(page, new RegExp(String(address.phone)), "the delivery phone reads back");
  });

  it("the invoice prices each line at the price it was bought at", async () => {
    const { user, product, address } = await scenario();
    const order = await placeOrder({ user, product, address });

    // The product goes on sale afterwards. An invoice that read the product
    // would re-price history.
    await Product.updateOne({ _id: product._id }, { $set: { price: 9999 } });

    const response = await post(`/account/orders/invoice/${order._id}`, user);
    assert.equal(response.status, 200, await response.clone().text());
    const bytes = Buffer.from(await response.arrayBuffer());
    // Pull the words the PDF actually prints, so the price check is about the
    // invoice and not about the numbers in its coordinates.
    const printed = [...bytes.toString("latin1").matchAll(/\((?:[^()\\]|\\.)*\)\s*Tj/g)]
      .map((match) => match[0].slice(1, match[0].lastIndexOf(")")))
      .join(" ");

    assert.ok(bytes.length > 500, "a PDF came back");
    assert.match(printed, /500\.00/, "the line is priced at what it cost then");
    assert.doesNotMatch(printed, /9,?999/, "the invoice is not priced off today's product");
  });

  it("an invoice for a deleted product still names the line", async () => {
    const { user, product, address } = await scenario();
    const order = await placeOrder({ user, product, address });
    await Product.deleteOne({ _id: product._id });

    const response = await post(`/account/orders/invoice/${order._id}`, user);
    assert.equal(
      response.status,
      200,
      `a deleted product is not a reason for a 404: ${await response.clone().text()}`,
    );
  });

  it("a line carries its own state, and the order follows when they are all cancelled", async () => {
    const { user, product, address } = await scenario();
    const order = await placeOrder({ user, product, quantity: 2, address });

    assert.equal(order.items[0].status, "pending");
    assert.ok(order.items[0]._id, "a line has an id, so it can be cancelled on its own");

    // This used to be written to a field the schema did not have, so strict
    // mode dropped it and the "every line cancelled" check could never be true.
    const response = await post(`/account/orders/${order._id}/cancel-item`, user, {
      json: { itemId: String(order.items[0]._id) },
    });
    assert.ok(
      response.status < 400,
      `cancelling one line: ${response.status} ${await response.clone().text()}`,
    );

    const after = await Order.findById(order._id);
    assert.equal(after.items[0].status, "cancelled", "the line state was written");
    assert.equal(after.status, "cancelled", "one order with one line is one cancelled order");
  });

  it("an order written in the old spellings still reads as closed", async () => {
    const { user, product, address } = await scenario();
    const order = await placeOrder({ user, product, address });

    // The three words that all meant "cancelled", written straight to the
    // database the way they used to be.
    for (const spelling of ["Cancelled", "cancelled", "completed"]) {
      await Order.updateOne({ _id: order._id }, { $set: { status: spelling }, strict: false });

      const response = await post(`/account/orders/${order._id}/cancel-reason`, user, {
        json: { reason: "changed my mind" },
      });
      assert.ok([302, 400].includes(response.status), `${spelling} is understood`);
      await Order.updateOne({ _id: order._id }, { $set: { status: "pending" }, strict: false });
    }

    assert.equal(normaliseOrderStatus("Delivered"), "delivered");
    assert.equal(normaliseOrderStatus("stock-unavailable"), "cancelled");
    assert.equal(normaliseOrderStatus("who knows"), "pending");
  });

  it("a cancelled order cannot be paid", async () => {
    const { user, product, address } = await scenario();
    const order = await placeOrder({ user, product, address });
    await Order.updateOne({ _id: order._id }, { $set: { status: "Cancelled" }, strict: false });

    const response = await post(`/account/orders/${order._id}/cancel-reason`, user, {
      json: { reason: "changed my mind" },
    });
    assert.ok(
      [302, 400, 409].includes(response.status),
      "a closed order is not re-opened by cancelling it again",
    );
  });

  it("the shop can only write a status that is on the list", async () => {
    const { user, product, address } = await scenario();
    const order = await placeOrder({ user, product, address });

    // Every word on the list is a state the application can write. Which of
    // them an order can be moved to is the next test; this one is about the
    // form refusing anything that is not a state at all.
    assert.deepEqual(ORDER_STATUSES, ["pending", "cancelled", "shipped", "delivered"]);

    for (const status of ["shipped", "cancelled"]) {
      const fresh = await placeOrder({ user, product, address });
      const response = await post(`/admin/orders/${fresh._id}/status`, null, {
        json: { status },
      });
      assert.equal(response.status, 200, `${status}: ${await response.clone().text()}`);
      assert.equal((await Order.findById(fresh._id)).status, status);
    }

    // Any string at all used to be written onto an order.
    const refused = await post(`/admin/orders/${order._id}/status`, null, {
      json: { status: "Delivered; DROP TABLE orders" },
    });
    assert.equal(refused.status, 400);
    assert.equal((await Order.findById(order._id)).status, "pending", "the last good value stands");
  });

  it("the shop can only move an order to a state that follows from where it is", async () => {
    const { user, product, address } = await scenario();

    const forward = await placeOrder({ user, product, address });
    assert.equal((await post(`/admin/orders/${forward._id}/status`, null, { json: { status: "shipped" } })).status, 200);
    assert.equal((await post(`/admin/orders/${forward._id}/status`, null, { json: { status: "delivered" } })).status, 200);

    // A closed order stays closed: it is not re-opened, and it is not walked
    // backwards. Both of these used to be a plain write.
    for (const wanted of ["pending", "shipped", "cancelled"]) {
      const response = await post(`/admin/orders/${forward._id}/status`, null, {
        json: { status: wanted },
      });
      assert.equal(response.status, 409, `a delivered order does not become ${wanted}`);
    }
    assert.equal((await Order.findById(forward._id)).status, "delivered");

    // The same answer, every time it is asked.
    const again = await post(`/admin/orders/${forward._id}/status`, null, {
      json: { status: "pending" },
    });
    assert.equal(again.status, 409);
    assert.equal((await again.json()).message, (await post(`/admin/orders/${forward._id}/status`, null, {
      json: { status: "pending" },
    }).then((r) => r.json())).message, "a refusal is the same refusal");
  });

  it("an order is dated by the database, not only by the field checkout wrote", async () => {
    const { user, product, address } = await scenario();
    const order = await placeOrder({ user, product, address });

    assert.ok(order.createdAt instanceof Date, "the admin list sorts on this");
    assert.ok(order.orderDate instanceof Date);
  });

  it("a phone number with a leading zero survives the round trip", async () => {
    const { user, product } = await scenario();
    const address = await createAddress({ user: user._id, ...addressFields(), phone: "09876543210" });
    const order = await placeOrder({ user, product, address });

    assert.equal(order.address.phone, "09876543210");
    const read = await Order.findById(order._id);
    assert.equal(read.address.phone, "09876543210");
  });

  it("the order says who paid with it, once", async () => {
    const { user, product, address } = await scenario();
    const order = await placeOrder({ user, product, address });

    assert.equal(order.paymentMethod, "cod");
    assert.equal(order.items.every((item) => item.paymentMethod === undefined), true, "the line is not asked to answer a second time");
    assert.deepEqual(PAYMENT_METHODS, ["razorpay", "cod", "wallet"]);
  });

  it("a payment method that is not one of ours is refused by the model", async () => {
    const { user, product, address } = await scenario();
    const cart = await createCart({ user: user._id, items: [{ product: product._id, quantity: 1, price: 500, discountPrice: 0 }] });

    await assert.rejects(
      () =>
        Order.create(
          buildOrder({
            user,
            cart,
            lines: [{ product, quantity: 1 }],
            address,
            paymentMethod: "cheque",
            paid: true,
          }),
        ),
      /paymentMethod/,
    );
  });

  it("the account has no second, unwritten record of its orders", async () => {
    const { user, product, address } = await scenario();
    await placeOrder({ user, product, address });

    const read = await User.findById(user._id);
    assert.equal(read.orders, undefined, "a ref to a model named Orders could never populate");
    assert.equal(await Order.countDocuments({ user: user._id }), 1);
  });

  it("the shop's pages speak the same four words the shopper's do", async () => {
    const { user, product, address } = await scenario();
    const order = await placeOrder({ user, product, address });
    await Order.updateOne({ _id: order._id }, { $set: { status: "Delivered" }, strict: false });
    const shipping = await placeOrder({ user, product, address });
    await Order.updateOne({ _id: shipping._id }, { $set: { status: "Shipped" }, strict: false });

    // The admin list and the admin detail page both ask what state this is.
    const list = await (await get("/admin/orders", null)).text();
    const detail = await (await get(`/admin/orders/${order._id}`, null)).text();

    assert.match(list, /delivered/, "the list shows the state as this application spells it");
    assert.doesNotMatch(list, /Delivered/, "the old spelling is not what is drawn");

    // The form posts the state back, so what it offers is the same word. The
    // label stays capitalised; the value it sends does not. A shipped order
    // offers exactly the one move that follows from being shipped.
    const shippedPage = await (await get(`/admin/orders/${shipping._id}`, null)).text();
    assert.match(shippedPage, /value="delivered"/, "the form offers the word this application uses");
    assert.doesNotMatch(shippedPage, /value="Delivered"/, "the form does not post the old spelling");
    assert.doesNotMatch(shippedPage, /value="pending"/, "a shipped order is not walked backwards");
    assert.doesNotMatch(detail, /orderStatusSelect/, "a delivered order is not given a form to change");
  });

  it("a legacy order that still carries the old address.user block reads fine", async () => {
    const { user, product, address } = await scenario();
    const order = await placeOrder({ user, product, address });

    // Written before the embedded copy of the buyer was removed.
    await Order.updateOne(
      { _id: order._id },
      {
        $set: {
          "address.user": { name: "Old Name", email: "old@example.com", phone_number: 1234567890 },
        },
        strict: false,
      },
    );

    const response = await get(`/account/orders/${order._id}`, user);
    assert.equal(response.status, 200, "an old order is not a broken order");
    const page = await response.text();
    assert.doesNotMatch(page, /Old Name/, "the copy left behind is not what the page shows");
  });
});
