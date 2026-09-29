import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import crypto from "node:crypto";
import express from "express";
import expressLayouts from "express-ejs-layouts";
import mongoose from "mongoose";
import path from "node:path";
import session from "express-session";
import { fileURLToPath } from "node:url";

import Address from "../models/address.models.js";
import Cart from "../models/cart.models.js";
import Order from "../models/orders.models.js";
import User from "../models/users.models.js";
import {
  CSRF_HEADER_NAME,
  exposeCsrfToken,
  injectCsrfFields,
  verifyCsrfRequest,
} from "../utils/csrf.js";
import { applyTestEnv } from "./helpers/test-env.js";
import {
  canReachTestDatabase,
  withTestDatabase,
} from "./helpers/test-db.js";
import {
  createAddress,
  createCart,
  createOrder,
  createProduct,
  createUser,
} from "./helpers/fixtures.js";

applyTestEnv();

// The payment controller reads its credentials while it loads, so every route
// is imported once the test environment is in place.
const cartRouter = (await import("../routes/cartRoute.js")).default;
const profileRouter = (await import("../routes/profileRoutes.js")).default;
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
      secret: "o".repeat(32),
      resave: false,
      saveUninitialized: true,
    }),
  );

  // The session locals the real server hands to every view.
  app.use((req, res, next) => {
    res.locals.name = req.session.user?.name;
    res.locals.toast = req.session.toast;
    delete req.session.toast;
    next();
  });

  // The CSRF pair, wired exactly as in server.js.
  app.locals.injectCsrfFields = injectCsrfFields;
  app.use(exposeCsrfToken);
  app.use(verifyCsrfRequest);

  // The suite plays the part of the login flow: the account a request acts as
  // is the one named by the x-test-user header.
  app.use((req, _res, next) => {
    const account = req.headers["x-test-user"];
    if (account) {
      req.session.user = { id: String(account), name: "Ownership Tester" };
    }
    next();
  });

  // A session carrier for the tests, so a client can hold one session open.
  app.get("/test/session", (req, res) => {
    res.json({ user: req.session.user ?? null, token: req.session.csrfToken ?? null });
  });

  app.use("/cart", cartRouter);
  app.use("/account", profileRouter);
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

// One client is one browser: it keeps its session cookie and its CSRF token,
// exactly like a signed in shopper.
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
      body: json
        ? JSON.stringify(json)
        : body
          ? new URLSearchParams(body).toString()
          : undefined,
    });

    return {
      status: response.status,
      location: response.headers.get("location"),
      text: await response.text(),
    };
  };
};

// One request, one freshly primed client. The account a request acts as is
// always named, so no two requests ever share a session by accident.
const send = async (server, requestPath, { method = "POST", as: account, body, json } = {}) =>
  createClient(server, account)(requestPath, { method, body, json });

const signatureFor = (razorpayOrderId, razorpayPaymentId) =>
  crypto
    .createHmac("sha256", process.env.RAZOR_SECRET_ID)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest("hex");

const validAddressFields = (overrides = {}) => ({
  name: "Test Recipient",
  street: "1 Test Street",
  city: "Testville",
  state: "Teststate",
  zip: "400001",
  phone: "9000000000",
  ...overrides,
});

describe("cart ownership", () => {
  let server;
  let reachable = false;

  before(async () => {
    reachable = await canReachTestDatabase();
    if (reachable) {
      server = await startServer();
    }
  });

  after(async () => {
    await server?.close();
  });

  const itWhenReachable = (name, fn) =>
    it(name, async (t) => {
      if (!reachable) {
        return t.skip("no MongoDB on the test URI");
      }
      return fn(t);
    });

  itWhenReachable("a quantity change only ever moves the caller's own cart", async () => {
    await withTestDatabase(async () => {
      const caller = await createUser();
      const stranger = await createUser();
      const product = await createProduct({ price: 500, discount: 0 });
      const callerCart = await createCart({
        user: caller._id,
        items: [{ product: product._id, quantity: 2, price: 500, discountPrice: 0 }],
      });
      const strangerCart = await createCart({
        user: stranger._id,
        items: [{ product: product._id, quantity: 3, price: 500, discountPrice: 0 }],
      });

      // The cart id of somebody else is sent along: it must not be honoured.
      const response = await send(server, "/cart/update-quantity", {
        as: caller._id,
        body: {
          cartId: String(strangerCart._id),
          productId: String(product._id),
          quantity: "9",
        },
      });

      assert.equal(response.status, 200);

      const ownCart = await Cart.findById(callerCart._id);
      const otherCart = await Cart.findById(strangerCart._id);
      assert.equal(ownCart.items[0].quantity, 9, "the caller's own cart is updated");
      assert.equal(otherCart.items[0].quantity, 3, "the other cart keeps its quantity");
    });
  });

  itWhenReachable("a removal cannot reach a line of another account's cart", async () => {
    await withTestDatabase(async () => {
      const caller = await createUser();
      const stranger = await createUser();
      const ownProduct = await createProduct({ price: 500, discount: 0 });
      const strangerProduct = await createProduct({ price: 700, discount: 0 });
      await createCart({
        user: caller._id,
        items: [{ product: ownProduct._id, quantity: 1, price: 500, discountPrice: 0 }],
      });
      const strangerCart = await createCart({
        user: stranger._id,
        items: [
          { product: strangerProduct._id, quantity: 1, price: 700, discountPrice: 0 },
        ],
      });

      const response = await send(server, "/cart/remove-item", {
        as: caller._id,
        body: {
          cartId: String(strangerCart._id),
          productId: String(strangerProduct._id),
        },
      });

      // A line that is not in the caller's cart answers as if it never existed.
      assert.equal(response.status, 404);
      assert.match(response.text, /not in cart/i);

      const otherCart = await Cart.findById(strangerCart._id);
      assert.equal(otherCart.items.length, 1);
    });
  });

  itWhenReachable("the client cannot set a cart total", async () => {
    await withTestDatabase(async () => {
      const caller = await createUser();
      await createCart({ user: caller._id, items: [] });

      const response = await send(server, "/cart/update-total", {
        as: caller._id,
        body: { totalAmount: "1" },
      });

      assert.equal(response.status, 404);
    });
  });

  itWhenReachable("adding to a cart validates the request and prices it from the product", async () => {
    await withTestDatabase(async () => {
      const caller = await createUser();
      const product = await createProduct({ price: 500, discount: 0 });

      const productId = String(product._id);

      const notAList = await send(server, "/cart/addProduct", {
        as: caller._id,
        json: { products: "not-a-list" },
      });
      assert.equal(notAList.status, 400);

      const emptyList = await send(server, "/cart/addProduct", {
        as: caller._id,
        json: { products: [] },
      });
      assert.equal(emptyList.status, 400);

      for (const quantity of [0, 11, "many", -1, 1.5]) {
        const rejected = await send(server, "/cart/addProduct", {
          as: caller._id,
          json: { products: [{ productId, quantity }] },
        });
        assert.equal(rejected.status, 400, `quantity ${quantity} is rejected`);
      }

      const unknownProduct = await send(server, "/cart/addProduct", {
        as: caller._id,
        json: {
          products: [
            { productId: String(new mongoose.Types.ObjectId()), quantity: 1 },
          ],
        },
      });
      assert.equal(unknownProduct.status, 404);

      const accepted = await send(server, "/cart/addProduct", {
        as: caller._id,
        json: { products: [{ productId, quantity: 2 }] },
      });
      assert.equal(accepted.status, 200);

      const cart = await Cart.findOne({ user: caller._id });
      assert.equal(cart.items.length, 1);
      assert.equal(cart.items[0].quantity, 2);
      assert.equal(cart.items[0].price, 500, "the line price comes from the product");
      assert.equal(cart.subtotal, 1000);
      assert.equal(Number(cart.total), 1000);
      assert.equal(Number(cart.cutoffAmount), 0);
    });
  });

  itWhenReachable("a cart line cannot grow past the per product limit", async () => {
    await withTestDatabase(async () => {
      const caller = await createUser();
      const product = await createProduct({ price: 500, discount: 0 });
      const productId = String(product._id);

      for (const quantity of [8, 2]) {
        const response = await send(server, "/cart/addProduct", {
          as: caller._id,
          json: { products: [{ productId, quantity }] },
        });
        assert.equal(response.status, 200, `quantity ${quantity}: ${response.text}`);
      }

      const grown = await Cart.findOne({ user: caller._id });
      assert.equal(grown.items.length, 1, "the line was added to, not duplicated");
      assert.equal(grown.items[0].quantity, 10, "the line grew while the limit allowed it");

      const overLimit = await send(server, "/cart/addProduct", {
        as: caller._id,
        json: { products: [{ productId, quantity: 1 }] },
      });
      assert.equal(overLimit.status, 400);
      assert.match(overLimit.text, /at most 10/i);

      const unchanged = await Cart.findOne({ user: caller._id });
      assert.equal(unchanged.items[0].quantity, 10, "the rejected add changed nothing");
    });
  });

  itWhenReachable("the cart page shows only the caller's own cart", async () => {
    await withTestDatabase(async () => {
      const caller = await createUser();
      const stranger = await createUser();
      const ownProduct = await createProduct({ price: 500, discount: 0, name: "Caller Toy" });
      const strangerProduct = await createProduct({ price: 700, discount: 0, name: "Stranger Toy" });
      await createCart({
        user: caller._id,
        items: [{ product: ownProduct._id, quantity: 1, price: 500, discountPrice: 0 }],
      });
      await createCart({
        user: stranger._id,
        items: [{ product: strangerProduct._id, quantity: 1, price: 700, discountPrice: 0 }],
      });

      const response = await send(server, "/cart", { method: "GET", as: caller._id });

      assert.equal(response.status, 200);
      assert.equal(response.text.includes("Caller Toy"), true);
      assert.equal(response.text.includes("Stranger Toy"), false);
    });
  });

  itWhenReachable("a cart request without a session user is sent to the login page", async () => {
    await withTestDatabase(async () => {
      const response = await send(server, "/cart/update-quantity", {
        body: { productId: String(new mongoose.Types.ObjectId()), quantity: "1" },
      });

      assert.equal(response.status, 302);
      assert.match(response.location, /\/user\/login/);
    });
  });
});

describe("address ownership", () => {
  let server;
  let reachable = false;

  before(async () => {
    reachable = await canReachTestDatabase();
    if (reachable) {
      server = await startServer();
    }
  });

  after(async () => {
    await server?.close();
  });

  const itWhenReachable = (name, fn) =>
    it(name, async (t) => {
      if (!reachable) {
        return t.skip("no MongoDB on the test URI");
      }
      return fn(t);
    });

  itWhenReachable("the edit form of another account's address is a 404", async () => {
    await withTestDatabase(async () => {
      const caller = await createUser();
      const stranger = await createUser();
      const strangerAddress = await createAddress({ user: stranger._id });

      const response = await send(server, `/account/edit-address/${strangerAddress._id}`, {
        method: "GET",
        as: caller._id,
      });

      assert.equal(response.status, 404);
    });
  });

  itWhenReachable("an edit cannot change another account's address", async () => {
    await withTestDatabase(async () => {
      const caller = await createUser();
      const stranger = await createUser();
      const strangerAddress = await createAddress({
        user: stranger._id,
        ...validAddressFields(),
      });

      const response = await send(server, `/account/edit-address/${strangerAddress._id}`, {
        as: caller._id,
        body: validAddressFields({ city: "Hijacked" }),
      });

      assert.equal(response.status, 404);
      const unchanged = await Address.findById(strangerAddress._id);
      assert.equal(unchanged.city, "Testville");
    });
  });

  itWhenReachable("a delete cannot remove another account's address", async () => {
    await withTestDatabase(async () => {
      const caller = await createUser();
      const stranger = await createUser();
      const strangerAddress = await createAddress({ user: stranger._id });

      const response = await send(server, `/account/delete-address/${strangerAddress._id}`, {
        as: caller._id,
      });

      assert.equal(response.status, 404);
      assert.notEqual(await Address.findById(strangerAddress._id), null);
    });
  });

  itWhenReachable("a default cannot be set on another account's address", async () => {
    await withTestDatabase(async () => {
      const caller = await createUser();
      const stranger = await createUser();
      const strangerAddress = await createAddress({ user: stranger._id });

      const response = await send(
        server,
        `/account/set-default-address/${strangerAddress._id}`,
        { as: caller._id },
      );

      assert.equal(response.status, 404);
      const unchanged = await Address.findById(strangerAddress._id);
      assert.equal(Boolean(unchanged.isDefault), false);
    });
  });

  itWhenReachable("an unknown address id answers like a foreign one", async () => {
    await withTestDatabase(async () => {
      const caller = await createUser();

      const response = await send(
        server,
        `/account/edit-address/${new mongoose.Types.ObjectId()}`,
        { as: caller._id },
      );

      assert.equal(response.status, 404);
    });
  });

  itWhenReachable("an invalid address is rejected and nothing is stored", async () => {
    await withTestDatabase(async () => {
      const caller = await createUser();

      const response = await send(server, "/account/add-address", {
        as: caller._id,
        body: validAddressFields({ phone: "not-a-number" }),
      });

      assert.equal(response.status, 400);
      assert.equal(await Address.countDocuments({ user: caller._id }), 0);
      assert.equal(await User.findById(caller._id).then((user) => user.addresses.length), 0);
    });
  });

  itWhenReachable("an account has one default address", async () => {
    await withTestDatabase(async () => {
      const caller = await createUser();

      const first = await send(server, "/account/add-address", {
        as: caller._id,
        body: validAddressFields({ city: "Firsttown" }),
      });
      assert.equal(first.status, 302);

      const second = await send(server, "/account/add-address", {
        as: caller._id,
        body: validAddressFields({ city: "Secondtown" }),
      });
      assert.equal(second.status, 302);

      const addresses = await Address.find({ user: caller._id }).sort({ date: 1 });
      assert.equal(addresses.length, 2);
      assert.equal(addresses[0].isDefault, true, "the first address is the default");
      assert.equal(addresses[1].isDefault, false);
      assert.equal(typeof addresses[0].phone, "string", "a phone number stays a string");

      const secondAddressId = addresses[1]._id;
      const switched = await send(
        server,
        `/account/set-default-address/${secondAddressId}`,
        { as: caller._id },
      );
      assert.equal(switched.status, 302);

      const afterSwitch = await Address.find({ user: caller._id }).sort({ date: 1 });
      assert.equal(afterSwitch[0].isDefault, false);
      assert.equal(afterSwitch[1].isDefault, true);
      assert.equal(
        afterSwitch.filter((address) => address.isDefault).length,
        1,
        "exactly one address is the default",
      );
    });
  });

  itWhenReachable("the address list shows only the caller's own addresses", async () => {
    await withTestDatabase(async () => {
      const caller = await createUser();
      const stranger = await createUser();
      await createAddress({ user: caller._id, ...validAddressFields({ city: "Callertown" }) });
      await createAddress({ user: stranger._id, ...validAddressFields({ city: "Strangertown" }) });

      const response = await send(server, "/account/address", {
        method: "GET",
        as: caller._id,
      });

      assert.equal(response.status, 200);
      assert.equal(response.text.includes("Callertown"), true);
      assert.equal(response.text.includes("Strangertown"), false);
      assert.equal(response.text.includes("/account/set-default-address/"), true);
      assert.equal(response.text.includes("Default"), true);
    });
  });

  itWhenReachable("deleting the default address hands the flag to another one", async () => {
    await withTestDatabase(async () => {
      const caller = await createUser();
      const address = await createAddress({ user: caller._id, ...validAddressFields() });
      const other = await createAddress({
        user: caller._id,
        ...validAddressFields({ city: "Secondtown" }),
      });
      await Address.updateOne({ _id: address._id }, { isDefault: true });

      const response = await send(server, `/account/delete-address/${address._id}`, {
        as: caller._id,
      });

      assert.equal(response.status, 302);
      assert.equal(await Address.findById(address._id), null);

      const remaining = await Address.find({ user: caller._id });
      assert.equal(remaining.length, 1);
      assert.equal(remaining[0].isDefault, true, "the surviving address became the default");
      assert.equal(String(remaining[0]._id), String(other._id));
    });
  });
});

describe("order ownership", () => {
  let server;
  let reachable = false;

  before(async () => {
    reachable = await canReachTestDatabase();
    if (reachable) {
      server = await startServer();
    }
  });

  after(async () => {
    await server?.close();
  });

  const itWhenReachable = (name, fn) =>
    it(name, async (t) => {
      if (!reachable) {
        return t.skip("no MongoDB on the test URI");
      }
      return fn(t);
    });

  itWhenReachable("the detail of another account's order is a 404", async () => {
    await withTestDatabase(async () => {
      const caller = await createUser();
      const stranger = await createUser();
      const strangerOrder = await createOrder({ user: stranger._id, totalAmount: 4321 });

      const response = await send(server, `/account/orders/${strangerOrder._id}`, {
        method: "GET",
        as: caller._id,
      });

      assert.equal(response.status, 404);
      assert.equal(response.text.includes("4321"), false, "no order data leaks");
    });
  });

  itWhenReachable("an order cannot be cancelled by another account", async () => {
    await withTestDatabase(async () => {
      const caller = await createUser();
      const stranger = await createUser();
      const strangerOrder = await createOrder({ user: stranger._id, status: "pending" });

      const response = await send(
        server,
        `/account/orders/${strangerOrder._id}/cancel-reason`,
        { as: caller._id },
      );

      assert.equal(response.status, 404);
      const unchanged = await Order.findById(strangerOrder._id);
      assert.equal(unchanged.status, "pending");
    });
  });

  itWhenReachable("the cancel form of another account's order is a 404", async () => {
    await withTestDatabase(async () => {
      const caller = await createUser();
      const stranger = await createUser();
      const strangerOrder = await createOrder({ user: stranger._id });

      const response = await send(
        server,
        `/account/orders/${strangerOrder._id}/cancel-reason`,
        { method: "GET", as: caller._id },
      );

      assert.equal(response.status, 404);
    });
  });

  itWhenReachable("an order line cannot be cancelled by another account", async () => {
    await withTestDatabase(async () => {
      const caller = await createUser();
      const stranger = await createUser();
      const strangerOrder = await createOrder({ user: stranger._id, status: "pending" });
      const itemId = String(strangerOrder.items[0]._id);

      const response = await send(
        server,
        `/account/orders/${strangerOrder._id}/cancel-item`,
        { as: caller._id, body: { itemId } },
      );

      assert.equal(response.status, 404);
      const unchanged = await Order.findById(strangerOrder._id);
      assert.equal(unchanged.items[0].status, "pending");
      assert.equal(unchanged.status, "pending");
    });
  });

  itWhenReachable("an invoice of another account's order is a 404", async () => {
    await withTestDatabase(async () => {
      const caller = await createUser();
      const stranger = await createUser();
      const strangerOrder = await createOrder({ user: stranger._id });

      const response = await send(
        server,
        `/account/orders/invoice/${strangerOrder._id}`,
        { as: caller._id },
      );

      assert.equal(response.status, 404);
      assert.equal(response.text.includes("%PDF"), false, "no invoice is produced");
    });
  });

  itWhenReachable("the success page only shows an order of the caller", async () => {
    await withTestDatabase(async () => {
      const caller = await createUser();
      const stranger = await createUser();
      const strangerOrder = await createOrder({ user: stranger._id });

      const response = await send(server, "/checkout/order-success", {
        as: caller._id,
        body: { orderId: String(strangerOrder._id) },
      });

      assert.equal(response.status, 404);
    });
  });

  itWhenReachable("a retry payment cannot be created for another account's order", async () => {
    await withTestDatabase(async () => {
      const caller = await createUser();
      const stranger = await createUser();
      const strangerOrder = await createOrder({ user: stranger._id, totalAmount: 9999 });

      const response = await send(server, "/checkout/retry-payment", {
        as: caller._id,
        body: { orderId: String(strangerOrder._id) },
      });

      assert.equal(response.status, 404);
      assert.equal(response.text.includes("9999"), false, "no amount leaks");
    });
  });

  itWhenReachable("a valid signature cannot mark another account's order as paid", async () => {
    await withTestDatabase(async () => {
      const caller = await createUser();
      const stranger = await createUser();
      const strangerOrder = await createOrder({ user: stranger._id, paid: false });

      const razorpayOrderId = "order_test_other_user";
      const razorpayPaymentId = "pay_test_other_user";
      const response = await send(server, "/checkout/verify-retry-payment", {
        as: caller._id,
        body: {
          orderId: String(strangerOrder._id),
          razorpay_order_id: razorpayOrderId,
          razorpay_payment_id: razorpayPaymentId,
          razorpay_signature: signatureFor(razorpayOrderId, razorpayPaymentId),
        },
      });

      assert.equal(response.status, 404);
      const unchanged = await Order.findById(strangerOrder._id);
      assert.equal(unchanged.paid, false, "the order is still unpaid");
    });
  });

  itWhenReachable("an order cannot be placed to another account's address", async () => {
    await withTestDatabase(async () => {
      const caller = await createUser();
      const stranger = await createUser();
      const strangerAddress = await createAddress({
        user: stranger._id,
        ...validAddressFields(),
      });
      const product = await createProduct({ price: 500, discount: 0, stock: 10 });
      await createCart({
        user: caller._id,
        items: [{ product: product._id, quantity: 1, price: 500, discountPrice: 0 }],
      });

      const response = await send(server, "/checkout", {
        as: caller._id,
        body: {
          selectedAddress: String(strangerAddress._id),
          paymentMethod: "cod",
          paid: "false",
        },
      });

      assert.equal(response.status, 400);
      assert.equal(await Order.countDocuments({}), 0, "no order was created");
    });
  });

  itWhenReachable("the order list of an account holds only its own orders", async () => {
    await withTestDatabase(async () => {
      const caller = await createUser();
      const stranger = await createUser();
      const ownOrder = await createOrder({ user: caller._id });
      const strangerOrder = await createOrder({ user: stranger._id });

      const response = await send(server, "/account/orders", {
        method: "GET",
        as: caller._id,
      });

      assert.equal(response.status, 200);
      assert.equal(response.text.includes(String(ownOrder._id)), true);
      assert.equal(response.text.includes(String(strangerOrder._id)), false);
    });
  });
});
