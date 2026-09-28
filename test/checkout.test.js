import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import crypto from "node:crypto";
import express from "express";
import expressLayouts from "express-ejs-layouts";
import path from "node:path";
import session from "express-session";
import { fileURLToPath } from "node:url";

import Cart from "../models/cart.models.js";
import Coupon from "../models/couponSchema.models.js";
import Order from "../models/orders.models.js";
import Product from "../models/product.models.js";
import User from "../models/users.models.js";
import Wallet from "../models/wallets.models.js";
import WalletLedger from "../models/walletLedger.models.js";
import { CSRF_HEADER_NAME, exposeCsrfToken, injectCsrfFields, verifyCsrfRequest } from "../utils/csrf.js";
import { resetRazorpayFactory, setRazorpayFactory } from "../utils/razorpay.js";
import { applyTestEnv } from "./helpers/test-env.js";
import { canReachTestDatabase, withTestDatabase } from "./helpers/test-db.js";
import {
  createAddress,
  createCart,
  createCoupon,
  createOrder,
  createProduct,
  createUser,
  createWallet,
} from "./helpers/fixtures.js";

applyTestEnv();

// The credentials are read while the route loads, so the routes are imported
// once the test environment is in place.
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

  app.use((req, res, next) => {
    res.locals.name = req.session.user?.name;
    res.locals.toast = req.session.toast;
    delete req.session.toast;
    next();
  });

  app.locals.injectCsrfFields = injectCsrfFields;
  app.use(exposeCsrfToken);
  app.use(verifyCsrfRequest);

  // The suite plays the part of the login flow: the account a request acts as
  // is the one named by the x-test-user header.
  app.use((req, _res, next) => {
    const account = req.headers["x-test-user"];
    if (account) {
      req.session.user = { id: String(account), name: "Checkout Tester" };
    }
    next();
  });

  app.get("/test/session", (req, res) => {
    res.json({ user: req.session.user ?? null, token: req.session.csrfToken ?? null });
  });

  // The order summary is rendered on its own, so a line whose product is gone
  // can be looked at without the stock guard turning the shopper away first.
  app.get("/test/render-checkout", async (req, res, next) => {
    try {
      const cart = await Cart.findOne({ user: req.session.user.id }).populate("items.product");
      const user = await User.findById(req.session.user.id).populate("addresses");
      res.render("user/checkout", {
        cart,
        user,
        coupons: [],
        offers: [],
        title: "Checkout",
        name: "Checkout Tester",
      });
    } catch (error) {
      next(error);
    }
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

const asJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const send = async (server, requestPath, { method = "POST", as: account, body, json } = {}) => {
  const response = await createClient(server, account)(requestPath, { method, body, json });
  return { ...response, data: asJson(response.text) };
};

const signatureFor = (razorpayOrderId, razorpayPaymentId) =>
  crypto
    .createHmac("sha256", process.env.RAZOR_SECRET_ID)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest("hex");

// A gateway that answers without a network, and remembers what it was asked for.
// `payment` decides what it says about a payment that was made, so a test can
// describe a payment that settled and a payment that did not.
const useFakeGateway = ({ fails = false, payment } = {}) => {
  const calls = [];
  const created = [];
  let sequence = 0;

  setRazorpayFactory(() => ({
    orders: {
      create: async (params) => {
        calls.push(params);
        if (fails) {
          throw new Error("the gateway is not answering");
        }
        sequence += 1;
        const order = { id: `order_fake_${sequence}`, amount: params.amount, currency: params.currency };
        created.push(order);
        return order;
      },
    },
    payments: {
      fetch: async (paymentId) => {
        calls.fetches.push(paymentId);
        if (fails) {
          throw new Error("the gateway is not answering");
        }

        const last = created[created.length - 1];
        const settled = {
          id: paymentId,
          order_id: last?.id,
          amount: last?.amount,
          currency: last?.currency ?? "INR",
          status: "captured",
        };

        // A test can hand back a whole payment, a change to one, or nothing at
        // all for a payment the gateway has never heard of.
        if (typeof payment === "function") {
          return payment({ paymentId, settled, last });
        }
        if (payment === null) {
          return null;
        }
        if (payment) {
          return { ...settled, ...payment };
        }
        return settled;
      },
    },
  }));

  calls.fetches = [];
  return calls;
};

const addressFields = (overrides = {}) => ({
  name: "Test Recipient",
  street: "1 Test Street",
  city: "Testville",
  state: "Teststate",
  zip: "400001",
  phone: "9000000000",
  ...overrides,
});

const cartFor = async (user, product, quantity = 1, overrides = {}) =>
  createCart({
    user: user._id,
    items: [{ product: product._id, quantity, price: product.price, discountPrice: 0 }],
    ...overrides,
  });

describe("checkout", () => {
  let server;
  let reachable = false;

  before(async () => {
    reachable = await canReachTestDatabase();
    if (reachable) {
      server = await startServer();
    }
  });

  after(async () => {
    resetRazorpayFactory();
    await server?.close();
  });

  const itWhenReachable = (name, fn) =>
    it(name, async (t) => {
      if (!reachable) {
        return t.skip("no MongoDB on the test URI");
      }
      return fn(t);
    });

  itWhenReachable("a total that is not the server total is refused and nothing is ordered", async () => {
    await withTestDatabase(async () => {
      const user = await createUser();
      const product = await createProduct({ price: 500, discount: 0, stock: 10 });
      const address = await createAddress({ user: user._id, ...addressFields() });
      await cartFor(user, product, 2);

      const response = await send(server, "/checkout", {
        as: user._id,
        body: {
          selectedAddress: String(address._id),
          paymentMethod: "cod",
          // The cart is worth 1000; the request says it is worth 1.
          totalAmount: "1",
        },
      });

      assert.equal(response.status, 409);
      assert.equal(response.data.totalChanged, true);
      assert.equal(response.data.totalAmount, 1000, "the new total is in the answer");
      assert.equal(await Order.countDocuments({}), 0, "no order was created");
      assert.equal((await Product.findById(product._id)).stock, 10, "no stock was taken");
    });
  });

  itWhenReachable("a price that moved is shown again instead of being charged", async () => {
    await withTestDatabase(async () => {
      const user = await createUser();
      const product = await createProduct({ price: 500, discount: 0, stock: 10 });
      const address = await createAddress({ user: user._id, ...addressFields() });
      await cartFor(user, product, 1);

      product.price = 800;
      await product.save();

      const stale = await send(server, "/checkout", {
        as: user._id,
        body: {
          selectedAddress: String(address._id),
          paymentMethod: "cod",
          totalAmount: "500",
        },
      });

      assert.equal(stale.status, 409);
      assert.equal(stale.data.totalAmount, 800, "the shopper is told the new price");

      // The shopper confirms the price they are now looking at.
      const confirmed = await send(server, "/checkout", {
        as: user._id,
        body: {
          selectedAddress: String(address._id),
          paymentMethod: "cod",
          totalAmount: "800",
        },
      });

      assert.equal(confirmed.status, 200);
      const order = await Order.findById(confirmed.data.orderId);
      assert.equal(Number(order.totalAmount), 800);
      assert.equal(order.items[0].price, 800, "the line carries the product price");
    });
  });

  itWhenReachable("the order is priced from the product, whatever the request claims", async () => {
    await withTestDatabase(async () => {
      const user = await createUser();
      const product = await createProduct({ price: 500, discount: 0, stock: 10 });
      const address = await createAddress({ user: user._id, ...addressFields() });
      await cartFor(user, product, 2);

      const response = await send(server, "/checkout", {
        as: user._id,
        body: {
          selectedAddress: String(address._id),
          paymentMethod: "cod",
          // None of this is read: no total, no paid flag, no coupon.
          paid: "true",
          couponCode: "NOT-A-CODE",
          cartId: "000000000000000000000000",
          totalAmount: "",
        },
      });

      assert.equal(response.status, 200);
      const order = await Order.findById(response.data.orderId);
      assert.equal(Number(order.totalAmount), 1000);
      assert.equal(order.paid, false, "cash on delivery is not paid");
      assert.equal(order.couponDiscount, 0, "no coupon was applied");
    });
  });

  itWhenReachable("the same attempt twice is one order and one reservation", async () => {
    await withTestDatabase(async () => {
      const user = await createUser();
      const product = await createProduct({ price: 500, discount: 0, stock: 10 });
      const address = await createAddress({ user: user._id, ...addressFields() });
      await cartFor(user, product, 2);

      const attempt = {
        selectedAddress: String(address._id),
        paymentMethod: "cod",
        checkoutKey: "attempt-one",
      };

      const first = await send(server, "/checkout", { as: user._id, body: attempt });
      assert.equal(first.status, 200);

      // The cart is gone, so a second try would find nothing to buy. The key is
      // what answers, and it must not reserve the stock a second time.
      const second = await send(server, "/checkout", { as: user._id, body: attempt });
      assert.equal(second.status, 200);
      assert.equal(String(second.data.orderId), String(first.data.orderId));

      assert.equal(await Order.countDocuments({ user: user._id }), 1);
      const after = await Product.findById(product._id);
      assert.equal(after.stock, 8, "the stock left once");
      assert.equal(after.sold, 2, "the sold count moved once");
    });
  });

  itWhenReachable("two checkouts cannot take the last unit between them", async () => {
    await withTestDatabase(async () => {
      const first = await createUser();
      const second = await createUser();
      const product = await createProduct({ price: 500, discount: 0, stock: 1 });
      const firstAddress = await createAddress({ user: first._id, ...addressFields() });
      const secondAddress = await createAddress({ user: second._id, ...addressFields() });
      await cartFor(first, product, 1);
      await cartFor(second, product, 1);

      const responses = await Promise.all([
        send(server, "/checkout", {
          as: first._id,
          body: { selectedAddress: String(firstAddress._id), paymentMethod: "cod", checkoutKey: "a" },
        }),
        send(server, "/checkout", {
          as: second._id,
          body: { selectedAddress: String(secondAddress._id), paymentMethod: "cod", checkoutKey: "b" },
        }),
      ]);

      const statuses = responses.map((response) => response.status).sort();
      assert.deepEqual(statuses, [200, 409], "one wins, one is told the unit is gone");

      const after = await Product.findById(product._id);
      assert.equal(after.stock, 0, "the shelf is not below zero");
      assert.equal(after.sold, 1);
      assert.equal(await Order.countDocuments({}), 1, "only one order exists");
    });
  });

  itWhenReachable("stock is given back when the order cannot be written", async () => {
    await withTestDatabase(async () => {
      const user = await createUser();
      const product = await createProduct({ price: 500, discount: 0, stock: 10 });
      const address = await createAddress({ user: user._id, ...addressFields() });
      await cartFor(user, product, 3);

      const writeOrder = Order.prototype.save;
      Order.prototype.save = async function refuse() {
        throw new Error("the write was refused");
      };

      let response;
      try {
        response = await send(server, "/checkout", {
          as: user._id,
          body: { selectedAddress: String(address._id), paymentMethod: "cod" },
        });
      } finally {
        Order.prototype.save = writeOrder;
      }

      assert.equal(response.status, 500);
      assert.equal(response.data.message.includes("write was refused"), false, "nothing leaks");
      assert.equal(await Order.countDocuments({}), 0);

      const after = await Product.findById(product._id);
      assert.equal(after.stock, 10, "the three units are back on the shelf");
      assert.equal(after.sold, 0);
      assert.ok(await Cart.findOne({ user: user._id }), "the cart is still there");
    });
  });

  itWhenReachable("a line whose product is gone is answered, not crashed on", async () => {
    await withTestDatabase(async () => {
      const user = await createUser();
      const product = await createProduct({ price: 500, discount: 0, stock: 10 });
      const address = await createAddress({ user: user._id, ...addressFields() });
      await cartFor(user, product, 1);

      // The product is taken off the shelf with the line still in the cart.
      await Product.deleteOne({ _id: product._id });

      const order = await send(server, "/checkout", {
        as: user._id,
        body: { selectedAddress: String(address._id), paymentMethod: "cod" },
      });

      assert.equal(order.status, 409, "a problem the shopper can act on");
      assert.match(order.data.message, /no longer available/i);
      assert.equal(await Order.countDocuments({}), 0);

      const page = await send(server, "/checkout", { method: "GET", as: user._id });
      assert.equal(page.status, 302, "the page turns the shopper back to the cart");
      assert.equal(page.location, "/cart");

      const rendered = await send(server, "/test/render-checkout", { method: "GET", as: user._id });
      assert.equal(rendered.status, 200, "the summary itself can be rendered");
    });
  });

  itWhenReachable("a product that is out of stock is answered, not crashed on", async () => {
    await withTestDatabase(async () => {
      const user = await createUser();
      const product = await createProduct({ price: 500, discount: 0, stock: 0 });
      const address = await createAddress({ user: user._id, ...addressFields() });
      await cartFor(user, product, 1);

      const response = await send(server, "/checkout", {
        as: user._id,
        body: { selectedAddress: String(address._id), paymentMethod: "cod" },
      });

      assert.equal(response.status, 409);
      assert.match(response.data.message, /out of stock/i);
      assert.equal(await Order.countDocuments({}), 0);
    });
  });

  itWhenReachable("a wallet is only spent when the balance is there, and the stock comes back", async () => {
    await withTestDatabase(async () => {
      const user = await createUser();
      const product = await createProduct({ price: 500, discount: 0, stock: 10 });
      const address = await createAddress({ user: user._id, ...addressFields() });
      await cartFor(user, product, 2);
      const wallet = await createWallet({ user: user._id, balance: 10 });

      const response = await send(server, "/checkout/wallet", {
        as: user._id,
        body: { selectedAddress: String(address._id), totalAmount: "1000" },
      });

      assert.equal(response.status, 400);
      assert.equal(await Order.countDocuments({}), 0);
      assert.equal((await Product.findById(product._id)).stock, 10, "the stock is back");
      assert.equal((await Wallet.findById(wallet._id)).balance, 10, "no money left the wallet");
      assert.equal(await WalletLedger.countDocuments({ wallet: wallet._id }), 0, "nothing was recorded");
    });
  });

  itWhenReachable("a wallet checkout spends the money once", async () => {
    await withTestDatabase(async () => {
      const user = await createUser();
      const product = await createProduct({ price: 500, discount: 0, stock: 10 });
      const address = await createAddress({ user: user._id, ...addressFields() });
      await cartFor(user, product, 2);
      const wallet = await createWallet({ user: user._id, balance: 1000 });

      const attempt = { selectedAddress: String(address._id), checkoutKey: "wallet-one" };

      const first = await send(server, "/checkout/wallet", { as: user._id, body: attempt });
      assert.equal(first.status, 200);
      assert.equal(Number(first.data.totalAmount), 1000);

      const second = await send(server, "/checkout/wallet", { as: user._id, body: attempt });
      assert.equal(second.status, 200);
      assert.equal(String(second.data.orderId), String(first.data.orderId));

      const order = await Order.findById(first.data.orderId);
      assert.equal(order.paid, true, "the wallet paid for it");
      assert.equal((await Wallet.findById(wallet._id)).balance, 0, "the money left once");
      const debits = await WalletLedger.find({ wallet: wallet._id }).lean();
      assert.equal(debits.length, 1, "the debit is in the ledger once");
      assert.equal(debits[0].type, "debit");
      assert.equal(debits[0].amount, 1000);
      assert.equal(debits[0].status, "applied");
      assert.equal(debits[0].balanceAfter, 0);
      assert.equal(String(debits[0].reference.order), String(order._id));
      const after = await Product.findById(product._id);
      assert.equal(after.stock, 8);
      assert.equal(await Order.countDocuments({}), 1);
    });
  });

  itWhenReachable("a coupon is measured against the cart, not against the number in the request", async () => {
    await withTestDatabase(async () => {
      const user = await createUser();
      const product = await createProduct({ price: 1000, discount: 0, stock: 10 });
      await cartFor(user, product, 2);
      const coupon = await createCoupon({
        discount: 10,
        discountType: "percentage",
        minPurchase: 1000,
        maxDiscount: 1000,
        usageLimit: 5,
      });

      const response = await send(server, "/checkout/apply-coupon", {
        as: user._id,
        body: { couponCode: coupon.couponCode, totalAmount: "100000" },
      });

      assert.equal(response.status, 200);
      assert.equal(response.data.discountAmount, 200, "a tenth of the 2000 in the cart");

      const cart = await Cart.findOne({ user: user._id });
      assert.equal(cart.appliedCoupon, coupon.couponCode);
      assert.equal(Number(cart.couponDiscount), 200);
      assert.equal(Number(cart.total), 1800, "the total is the one the cart is worth");
    });
  });

  itWhenReachable("a coupon is refused when the cart does not reach its minimum", async () => {
    await withTestDatabase(async () => {
      const user = await createUser();
      const product = await createProduct({ price: 500, discount: 0, stock: 10 });
      await cartFor(user, product, 1);
      const coupon = await createCoupon({
        discount: 10,
        discountType: "percentage",
        minSpend: 5000,
        usageLimit: 5,
      });

      const response = await send(server, "/checkout/apply-coupon", {
        as: user._id,
        body: { couponCode: coupon.couponCode, totalAmount: "5000" },
      });

      assert.equal(response.status, 400);
      assert.match(response.data.message, /at least 5000/);

      const cart = await Cart.findOne({ user: user._id });
      assert.equal(cart.appliedCoupon, null, "the coupon was not applied");
      assert.equal(Number(cart.couponDiscount), 0);
    });
  });

  itWhenReachable("a coupon that is no longer valid stops being applied", async () => {
    await withTestDatabase(async () => {
      const user = await createUser();
      const product = await createProduct({ price: 500, discount: 0, stock: 10 });
      const address = await createAddress({ user: user._id, ...addressFields() });
      await createCoupon({ couponCode: "GONE", usageLimit: 5, isBlocked: true });
      await cartFor(user, product, 2, { appliedCoupon: "GONE", couponDiscount: 500 });

      const response = await send(server, "/checkout", {
        as: user._id,
        body: { selectedAddress: String(address._id), paymentMethod: "cod" },
      });

      assert.equal(response.status, 200);
      const order = await Order.findById(response.data.orderId);
      assert.equal(Number(order.couponDiscount), 0, "the coupon was dropped");
      assert.equal(Number(order.totalAmount), 1000, "the full price was charged");
    });
  });

  itWhenReachable("a payment signature for another gateway order is refused", async () => {
    useFakeGateway();

    await withTestDatabase(async () => {
      const user = await createUser();
      const product = await createProduct({ price: 500, discount: 0, stock: 10 });
      const address = await createAddress({ user: user._id, ...addressFields() });
      await cartFor(user, product, 1);

      const strangerGatewayOrder = "order_somewhere_else";
      const payment = "pay_somewhere_else";
      const response = await send(server, "/checkout/verify-payment", {
        as: user._id,
        body: {
          selectedAddress: String(address._id),
          razorpay_order_id: strangerGatewayOrder,
          razorpay_payment_id: payment,
          razorpay_signature: signatureFor(strangerGatewayOrder, payment),
        },
      });

      assert.equal(response.status, 400);
      assert.equal(await Order.countDocuments({}), 0);
    });
  });

  itWhenReachable("the gateway is asked for the amount the server calculated", async () => {
    const calls = useFakeGateway();

    await withTestDatabase(async () => {
      const user = await createUser();
      const product = await createProduct({ price: 500, discount: 0, stock: 10 });
      const address = await createAddress({ user: user._id, ...addressFields() });
      await cartFor(user, product, 2);

      const response = await send(server, "/checkout/create-razorpay-order", {
        as: user._id,
        body: {
          selectedAddress: String(address._id),
          checkoutKey: "razor-one",
          totalAmount: "1000",
        },
      });

      assert.equal(response.status, 200);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].amount, 100000, "1000 rupees in the smallest unit");
      assert.equal(response.data.amount, 100000);

      const order = await Order.findOne({ user: user._id });
      assert.equal(order.razorpayOrderId, response.data.orderId);
      assert.equal(order.razorpayAmount, 100000);
      assert.equal(order.paid, false, "nothing is paid before the payment");
      assert.equal((await Product.findById(product._id)).stock, 8, "the stock is held");
      assert.ok(await Cart.findOne({ user: user._id }), "the cart waits for the payment");
    });
  });

  itWhenReachable("a payment is only accepted for the order it was created for, and only once", async () => {
    useFakeGateway();

    await withTestDatabase(async () => {
      const user = await createUser();
      const product = await createProduct({ price: 500, discount: 0, stock: 10 });
      const address = await createAddress({ user: user._id, ...addressFields() });
      await cartFor(user, product, 2);

      const attempt = await send(server, "/checkout/create-razorpay-order", {
        as: user._id,
        body: {
          selectedAddress: String(address._id),
          checkoutKey: "razor-two",
          totalAmount: "1000",
        },
      });
      assert.equal(attempt.status, 200);

      const gatewayOrderId = attempt.data.orderId;
      const payment = "pay_two";
      const paymentBody = {
        selectedAddress: String(address._id),
        razorpay_order_id: gatewayOrderId,
        razorpay_payment_id: payment,
        razorpay_signature: signatureFor(gatewayOrderId, payment),
      };

      const first = await send(server, "/checkout/verify-payment", {
        as: user._id,
        body: paymentBody,
      });
      assert.equal(first.status, 200);

      const order = await Order.findById(first.data.orderId);
      assert.equal(order.paid, true);
      assert.equal(order.razorpayPaymentId, payment);
      assert.equal((await Product.findById(product._id)).stock, 8, "the stock was taken once");
      assert.equal((await Cart.findOne({ user: user._id })), null, "the cart is gone");
      const buyer = await User.findById(user._id);
      assert.equal(buyer.totalProductsBuyed, 2, "the purchase is counted once");

      const second = await send(server, "/checkout/verify-payment", {
        as: user._id,
        body: paymentBody,
      });
      assert.equal(second.status, 200);
      assert.equal(second.data.repeated, true);
      assert.equal((await User.findById(user._id)).totalProductsBuyed, 2, "still counted once");
      assert.equal((await Product.findById(product._id)).stock, 8);
    });
  });

  itWhenReachable("a payment the gateway does not know about pays for nothing", async () => {
    useFakeGateway({ payment: null });

    await withTestDatabase(async () => {
      const user = await createUser();
      const product = await createProduct({ price: 500, discount: 0, stock: 10 });
      const address = await createAddress({ user: user._id, ...addressFields() });
      await cartFor(user, product, 2);

      const started = await send(server, "/checkout/create-razorpay-order", {
        as: user._id,
        body: {
          selectedAddress: String(address._id),
          checkoutKey: "razor-unknown-payment",
          totalAmount: "1000",
        },
      });
      assert.equal(started.status, 200);

      const payment = "pay_unknown";
      const response = await send(server, "/checkout/verify-payment", {
        as: user._id,
        body: {
          selectedAddress: String(address._id),
          razorpay_order_id: started.data.orderId,
          razorpay_payment_id: payment,
          razorpay_signature: signatureFor(started.data.orderId, payment),
        },
      });

      assert.equal(response.status, 400);
      const order = await Order.findOne({ user: user._id });
      assert.equal(order.paid, false, "a payment the gateway has never seen is not a payment");
      assert.equal(order.razorpayPaymentId ?? null, null, "no payment was recorded");
      assert.ok(await Cart.findOne({ user: user._id }), "the cart waits for a real payment");
    });
  });

  itWhenReachable("a payment that did not settle pays for nothing", async () => {
    for (const status of ["created", "attempted", "failed"]) {
      useFakeGateway({ payment: { status } });

      await withTestDatabase(async () => {
        const user = await createUser();
        const product = await createProduct({ price: 500, discount: 0, stock: 10 });
        const address = await createAddress({ user: user._id, ...addressFields() });
        await cartFor(user, product, 2);

        const started = await send(server, "/checkout/create-razorpay-order", {
          as: user._id,
          body: {
            selectedAddress: String(address._id),
            checkoutKey: `razor-${status}`,
            totalAmount: "1000",
          },
        });
        assert.equal(started.status, 200);

        const payment = `pay_${status}`;
        const response = await send(server, "/checkout/verify-payment", {
          as: user._id,
          body: {
            selectedAddress: String(address._id),
            razorpay_order_id: started.data.orderId,
            razorpay_payment_id: payment,
            razorpay_signature: signatureFor(started.data.orderId, payment),
          },
        });

        assert.equal(response.status, 400, `${status} is not a payment that settled`);
        assert.equal((await Order.findOne({ user: user._id })).paid, false);
      });
    }
  });

  itWhenReachable("a payment for a different amount, order or currency pays for nothing", async () => {
    const cases = [
      { name: "amount", payment: { amount: 1 } },
      { name: "order", payment: { order_id: "order_somebody_elses" } },
      { name: "currency", payment: { currency: "USD" } },
    ];

    for (const { name, payment } of cases) {
      useFakeGateway({ payment });

      await withTestDatabase(async () => {
        const user = await createUser();
        const product = await createProduct({ price: 500, discount: 0, stock: 10 });
        const address = await createAddress({ user: user._id, ...addressFields() });
        await cartFor(user, product, 2);

        const started = await send(server, "/checkout/create-razorpay-order", {
          as: user._id,
          body: {
            selectedAddress: String(address._id),
            checkoutKey: `razor-wrong-${name}`,
            totalAmount: "1000",
          },
        });
        assert.equal(started.status, 200);

        const paymentId = `pay_wrong_${name}`;
        const response = await send(server, "/checkout/verify-payment", {
          as: user._id,
          body: {
            selectedAddress: String(address._id),
            razorpay_order_id: started.data.orderId,
            razorpay_payment_id: paymentId,
            razorpay_signature: signatureFor(started.data.orderId, paymentId),
          },
        });

        assert.equal(response.status, 400, `a payment with the wrong ${name} is not accepted`);
        assert.equal((await Order.findOne({ user: user._id })).paid, false);
      });
    }
  });

  itWhenReachable("a gateway that cannot be asked leaves the order unpaid", async () => {
    await withTestDatabase(async () => {
      const user = await createUser();
      const product = await createProduct({ price: 500, discount: 0, stock: 10 });
      const address = await createAddress({ user: user._id, ...addressFields() });
      await cartFor(user, product, 2);

      const gateway = useFakeGateway();
      const started = await send(server, "/checkout/create-razorpay-order", {
        as: user._id,
        body: {
          selectedAddress: String(address._id),
          checkoutKey: "razor-gateway-down",
          totalAmount: "1000",
        },
      });
      assert.equal(started.status, 200);

      // The payment is made, and then the gateway stops answering.
      setRazorpayFactory(() => ({
        payments: {
          fetch: async () => {
            throw new Error("the gateway is not answering");
          },
        },
      }));

      const payment = "pay_gateway_down";
      const response = await send(server, "/checkout/verify-payment", {
        as: user._id,
        body: {
          selectedAddress: String(address._id),
          razorpay_order_id: started.data.orderId,
          razorpay_payment_id: payment,
          razorpay_signature: signatureFor(started.data.orderId, payment),
        },
      });

      assert.equal(response.status, 502, "the shop says it could not confirm the payment");
      assert.equal((await Order.findOne({ user: user._id })).paid, false, "nothing was shipped");
      assert.ok(await Cart.findOne({ user: user._id }), "the cart is kept");
      assert.ok(gateway.fetches.length === 0, "the fake was never asked");
    });
  });

  itWhenReachable("a retry payment is also checked against the gateway", async () => {
    useFakeGateway({ payment: { status: "failed" } });

    await withTestDatabase(async () => {
      const user = await createUser();
      const product = await createProduct({ price: 500, discount: 0, stock: 10 });
      const address = await createAddress({ user: user._id, ...addressFields() });
      await cartFor(user, product, 1);

      const started = await send(server, "/checkout/create-razorpay-order", {
        as: user._id,
        body: {
          selectedAddress: String(address._id),
          checkoutKey: "razor-retry-failed",
          totalAmount: "500",
        },
      });
      assert.equal(started.status, 200);

      const order = await Order.findOne({ user: user._id });
      const payment = "pay_retry_failed";
      const response = await send(server, "/checkout/verify-retry-payment", {
        as: user._id,
        body: {
          orderId: String(order._id),
          razorpay_order_id: started.data.orderId,
          razorpay_payment_id: payment,
          razorpay_signature: signatureFor(started.data.orderId, payment),
        },
      });

      assert.equal(response.status, 400);
      assert.equal((await Order.findById(order._id)).paid, false, "a failed payment is not a payment");
    });
  });

  itWhenReachable("a gateway that will not answer leaves no order and no stock taken", async () => {
    useFakeGateway({ fails: true });

    await withTestDatabase(async () => {
      const user = await createUser();
      const product = await createProduct({ price: 500, discount: 0, stock: 10 });
      const address = await createAddress({ user: user._id, ...addressFields() });
      await cartFor(user, product, 2);

      const response = await send(server, "/checkout/create-razorpay-order", {
        as: user._id,
        body: {
          selectedAddress: String(address._id),
          checkoutKey: "razor-three",
          totalAmount: "1000",
        },
      });

      assert.equal(response.status, 502);
      assert.equal(await Order.countDocuments({}), 0, "no half made order is left");
      const after = await Product.findById(product._id);
      assert.equal(after.stock, 10, "the stock is back");
      assert.equal(after.sold, 0);
      assert.ok(await Cart.findOne({ user: user._id }), "the cart is untouched");
    });
  });

  itWhenReachable("a declined card gives the held stock back and keeps the cart", async () => {
    useFakeGateway();

    await withTestDatabase(async () => {
      const user = await createUser();
      const product = await createProduct({ price: 500, discount: 0, stock: 10 });
      const address = await createAddress({ user: user._id, ...addressFields() });
      await cartFor(user, product, 2);

      const key = "razor-declined";
      const started = await send(server, "/checkout/create-razorpay-order", {
        as: user._id,
        body: { selectedAddress: String(address._id), checkoutKey: key, totalAmount: "1000" },
      });
      assert.equal(started.status, 200);
      assert.equal((await Product.findById(product._id)).stock, 8);

      const declined = await send(server, "/checkout", {
        as: user._id,
        body: {
          selectedAddress: String(address._id),
          paymentMethod: "razorpay",
          checkoutKey: key,
          paymentFailed: "true",
        },
      });

      assert.equal(declined.status, 200);
      assert.equal(await Order.countDocuments({}), 0, "the unpaid order is gone");
      const after = await Product.findById(product._id);
      assert.equal(after.stock, 10, "the stock is back on the shelf");
      assert.equal(after.sold, 0);
      assert.ok(await Cart.findOne({ user: user._id }), "the cart is still there");
    });
  });

  itWhenReachable("a retry payment can only be paid by the gateway order it created", async () => {
    const calls = useFakeGateway();

    await withTestDatabase(async () => {
      const user = await createUser();
      const product = await createProduct({ price: 500, discount: 0, stock: 10 });
      const address = await createAddress({ user: user._id, ...addressFields() });
      await cartFor(user, product, 2);
      const order = await createOrder({
        user: user._id,
        totalAmount: 1000,
        subtotal: 1000,
        items: [{ product: product._id, quantity: 2, price: 500, paymentMethod: "cod" }],
        address: {
          ...addressFields(),
          user: {
            name: user.name,
            email: user.email,
            phone_number: user.phone_number,
            joined_date: user.joined_date,
          },
        },
        paymentMethod: "cod",
        paid: false,
      });

      const retry = await send(server, "/checkout/retry-payment", {
        as: user._id,
        body: { orderId: String(order._id) },
      });

      assert.equal(retry.status, 200);
      assert.equal(calls.at(-1).amount, 100000, "the order total, not the cart");

      const replaced = "order_the_old_one";
      const oldPayment = "pay_old";
      const stale = await send(server, "/checkout/verify-retry-payment", {
        as: user._id,
        body: {
          orderId: String(order._id),
          razorpay_order_id: replaced,
          razorpay_payment_id: oldPayment,
          razorpay_signature: signatureFor(replaced, oldPayment),
        },
      });

      assert.equal(stale.status, 400, "the gateway order that was replaced pays nothing");
      assert.equal((await Order.findById(order._id)).paid, false);

      const payment = "pay_retry";
      const good = await send(server, "/checkout/verify-retry-payment", {
        as: user._id,
        body: {
          orderId: String(order._id),
          razorpay_order_id: retry.data.razorpay_order_id,
          razorpay_payment_id: payment,
          razorpay_signature: signatureFor(retry.data.razorpay_order_id, payment),
        },
      });

      assert.equal(good.status, 200);
      assert.equal((await Order.findById(order._id)).paid, true);
    });
  });

  itWhenReachable("an order that was cancelled cannot be paid any more", async () => {
    useFakeGateway();

    await withTestDatabase(async () => {
      const user = await createUser();
      const order = await createOrder({
        user: user._id,
        totalAmount: 500,
        status: "Cancelled",
        paid: false,
        razorpayOrderId: "order_cancelled",
        razorpayAmount: 50000,
      });

      const payment = "pay_cancelled";
      const response = await send(server, "/checkout/verify-retry-payment", {
        as: user._id,
        body: {
          orderId: String(order._id),
          razorpay_order_id: "order_cancelled",
          razorpay_payment_id: payment,
          razorpay_signature: signatureFor("order_cancelled", payment),
        },
      });

      assert.equal(response.status, 409);
      assert.equal((await Order.findById(order._id)).paid, false);
    });
  });

  itWhenReachable("a wallet order cannot be written through the ordinary checkout", async () => {
    await withTestDatabase(async () => {
      const user = await createUser();
      const product = await createProduct({ price: 500, discount: 0, stock: 10 });
      const address = await createAddress({ user: user._id, ...addressFields() });
      await cartFor(user, product, 1);
      const wallet = await createWallet({ user: user._id, balance: 5000 });

      const response = await send(server, "/checkout", {
        as: user._id,
        body: {
          selectedAddress: String(address._id),
          paymentMethod: "wallet",
          paid: "true",
          totalAmount: "500",
        },
      });

      assert.equal(response.status, 400);
      assert.equal(await Order.countDocuments({}), 0, "no unpaid wallet order is written");
      assert.equal((await Wallet.findById(wallet._id)).balance, 5000, "no money was spent");
      assert.equal((await Product.findById(product._id)).stock, 10);
    });
  });

  itWhenReachable("a checkout without a session is turned away", async () => {
    await withTestDatabase(async () => {
      const response = await send(server, "/checkout", {
        body: { selectedAddress: "000000000000000000000000", paymentMethod: "cod" },
      });

      assert.equal(response.status, 302, "the request never reaches a handler");
      assert.equal(response.location, "/user/login");
    });
  });
});
