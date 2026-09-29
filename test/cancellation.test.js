import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import express from "express";
import crypto from "node:crypto";
import session from "express-session";

import Order from "../models/orders.models.js";
import Product from "../models/product.models.js";
import Wallet from "../models/wallets.models.js";
import WalletLedger from "../models/walletLedger.models.js";
import { getOrCreateWallet } from "../utils/wallet.js";
import { setRazorpayFactory } from "../utils/razorpay.js";
import {
  ADMIN_TRANSITIONS,
  adminTransition,
  cancellationMessage,
  lineCancellation,
  lineShare,
  refundPlanFor,
  wholeOrderCancellation,
} from "../utils/order-transitions.js";
import profile from "../controllers/userModules/profile.js";
import adminOrder from "../controllers/adminModules/order.js";
import { CSRF_HEADER_NAME, exposeCsrfToken, injectCsrfFields, verifyCsrfRequest } from "../utils/csrf.js";
import { applyTestEnv } from "./helpers/test-env.js";
import {
  canReachTestDatabase,
  clearTestDatabase,
  connectTestDatabase,
  disconnectTestDatabase,
} from "./helpers/test-db.js";
import { createProduct, createUser } from "./helpers/fixtures.js";

applyTestEnv();

// The rules, asked directly, without a database or a request. What may change
// and where the money goes are both answers that do not need anything else.
describe("the order rules", () => {
  const order = (overrides = {}) => ({
    _id: "65b0f1c2a3d4e5f60718293a",
    user: "65b0f1c2a3d4e5f60718293b",
    status: "pending",
    paymentMethod: "cod",
    paid: false,
    totalAmount: 500,
    items: [],
    ...overrides,
  });

  it("an order can only be called back while it is still here", () => {
    assert.equal(wholeOrderCancellation(order()).allowed, true);

    // Every way the old data can spell these, refused the same way.
    for (const status of ["cancelled", "Cancelled", "canceled", "completed", "stock-unavailable"]) {
      const outcome = wholeOrderCancellation(order({ status }));
      assert.equal(outcome.allowed, false, status);
      assert.equal(outcome.reason, "already_cancelled", status);
    }

    for (const status of ["shipped", "Shipped", "dispatched"]) {
      assert.equal(wholeOrderCancellation(order({ status })).reason, "already_shipped", status);
    }

    for (const status of ["delivered", "Delivered"]) {
      assert.equal(wholeOrderCancellation(order({ status })).reason, "already_delivered", status);
    }

    // An order written as something this does not recognise is treated as open,
    // which is the state that can still be acted on.
    assert.equal(wholeOrderCancellation(order({ status: "who knows" })).allowed, true);
  });

  it("a reason is written for a shopper, not a sentence about them", () => {
    for (const reason of [
      "already_cancelled",
      "already_shipped",
      "already_delivered",
      "order_is_shipped",
      "order_is_delivered",
    ]) {
      assert.match(cancellationMessage(reason), /\S/, reason);
    }
    assert.match(cancellationMessage("already_shipped"), /shipped/);
  });

  it("a line follows the parcel it is in", () => {
    assert.equal(lineCancellation(order()).allowed, true);

    for (const status of ["shipped", "delivered", "cancelled", "Cancelled"]) {
      const outcome = lineCancellation(order({ status }));
      assert.equal(outcome.allowed, false, status);
      assert.equal(outcome.reason, `order_is_${outcome.status}`, status);
    }
  });

  it("money only goes back to where it came from", () => {
    // Nothing was taken, so nothing is given. A delivery order is never a
    // source of credit, whatever else is true of it.
    assert.equal(refundPlanFor(order({ paymentMethod: "cod" }), 500).method, "none");
    assert.equal(
      refundPlanFor(order({ paymentMethod: "cod", paid: true }), 500).reason,
      "no_money_taken",
      "a paid cash order still took no card and spent no balance",
    );

    // An order that was never charged is never refunded: that would be paying
    // the shopper for an order they did not buy.
    assert.equal(refundPlanFor(order({ paymentMethod: "razorpay", paid: false }), 500).reason, "not_paid");
    assert.equal(refundPlanFor(order({ paymentMethod: "wallet", paid: false }), 500).reason, "not_paid");

    // A card payment goes back to the card, and a wallet payment goes back to
    // the balance it came out of.
    assert.equal(refundPlanFor(order({ paymentMethod: "razorpay", paid: true }), 500).method, "razorpay");
    assert.equal(refundPlanFor(order({ paymentMethod: "wallet", paid: true }), 500).method, "wallet");

    // Nothing to give is nothing to do.
    assert.equal(refundPlanFor(order({ paymentMethod: "razorpay", paid: true }), 0).reason, "nothing_to_refund");
    assert.equal(refundPlanFor(order({ paymentMethod: "razorpay", paid: true }), -5).reason, "nothing_to_refund");
  });

  it("the shop can move an order forwards and not backwards", () => {
    assert.deepEqual(ADMIN_TRANSITIONS.pending, ["cancelled", "shipped"]);
    assert.deepEqual(ADMIN_TRANSITIONS.shipped, ["delivered"]);
    assert.deepEqual(ADMIN_TRANSITIONS.delivered, []);
    assert.deepEqual(ADMIN_TRANSITIONS.cancelled, []);

    assert.equal(adminTransition(order(), "shipped").allowed, true);
    assert.equal(adminTransition(order({ status: "Delivered" }), "pending").allowed, false);
    assert.equal(adminTransition(order({ status: "Delivered" }), "shipped").reason, "order_is_closed");
    assert.equal(adminTransition(order(), "delivered").allowed, false, "pending skips no steps");
  });

  it("a line's share of what was paid is the line's part of the order by value", () => {
    const two = order({
      totalAmount: 900,
      items: [
        { price: 500, quantity: 1 },
        { price: 200, quantity: 2 },
      ],
    });

    assert.equal(lineShare(two, two.items[0]), 500, "500 of 900 gross");
    assert.equal(lineShare(two, two.items[1]), 400, "400 of 900 gross");

    // An order whose lines say nothing is not divided.
    assert.equal(lineShare(order({ totalAmount: 100, items: [] }), { price: 0, quantity: 0 }), 0);
  });
});

const reachable = await canReachTestDatabase();
const describeWhenReachable = reachable ? describe : describe.skip;

describeWhenReachable("cancelling an order", () => {
  let server;

  const useFakeGateway = ({ refundFails = false, payment = "settled" } = {}) => {
    const calls = { refunds: [], fetched: [] };
    setRazorpayFactory(() => ({
      orders: { create: async () => ({ id: "order_never_used", amount: 0 }) },
      payments: {
        fetch: async (paymentId) => {
          calls.fetched.push(paymentId);
          // "settled" is the ordinary case; a test can describe a payment that
          // was never taken, or one the gateway has not heard of.
          if (payment === "unknown") {
            return null;
          }
          return {
            id: paymentId,
            order_id: "order_online_1",
            amount: 50000,
            currency: "INR",
            status: "captured",
            ...(typeof payment === "object" ? payment : {}),
          };
        },
        refund: async (paymentId, params) => {
          calls.refunds.push({ paymentId, params });
          if (refundFails) {
            throw new Error("the gateway will not refund this");
          }
          return { id: "rfnd_1", payment_id: paymentId, amount: params.amount, status: "processed" };
        },
      },
    }));
    return calls;
  };

  const buildApp = () => {
    const app = express();
    app.use(express.urlencoded({ extended: true }));
    app.use(express.json());
    app.use(
      session({ name: "toyhub.sid", secret: "t".repeat(32), resave: false, saveUninitialized: true }),
    );
    app.use((req, res, next) => {
      if (req.headers["x-test-user"]) {
        req.session.user = { id: req.headers["x-test-user"], name: "Test" };
      }
      next();
    });
    app.locals.injectCsrfFields = injectCsrfFields;
    app.use(exposeCsrfToken);
    app.use(verifyCsrfRequest);
    app.get("/test/session", (req, res) => {
      res.json({ token: req.session.csrfToken ?? null });
    });
    app.post("/account/orders/:id/cancel-reason", profile.postOrderCancel);
    app.post("/account/orders/:orderId/cancel-item", profile.postItemCancel);
    app.post("/admin/orders/:id/status", adminOrder.postUpdateOrderStatus);
    app.use((error, req, res, _next) => {
      res.status(error.status || 500).json({ message: error.message });
    });
    return app;
  };

  const client = () => {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    let cookie = null;
    let token = null;

    const prime = async (as) => {
      const primed = await fetch(`${baseUrl}/test/session`, {
        headers: as ? { "x-test-user": String(as) } : {},
      });
      cookie = primed.headers.getSetCookie?.()[0]?.split(";")[0] ?? null;
      token = (await primed.json()).token ?? null;
    };

    return async (requestPath, { as = null, json } = {}) => {
      if (token === null) {
        await prime(as);
      }
      return fetch(`${baseUrl}${requestPath}`, {
        method: "POST",
        redirect: "manual",
        headers: {
          ...(cookie ? { cookie } : {}),
          ...(token ? { [CSRF_HEADER_NAME]: token } : {}),
          ...(as ? { "x-test-user": String(as) } : {}),
          ...(json ? { "content-type": "application/json" } : {}),
        },
        body: json ? JSON.stringify(json) : undefined,
      });
    };
  };

  before(async () => {
    if (!(await connectTestDatabase())) {
      return;
    }
    server = buildApp().listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    setRazorpayFactory(null);
    await disconnectTestDatabase();
  });

  beforeEach(async () => {
    if (server) {
      await clearTestDatabase();
    }
  });

  const orderFor = async ({ lines = 1, quantity = 1, ...overrides } = {}) => {
    const user = await createUser();
    const product = await createProduct({ price: 500, stock: 4, sold: 2 });
    const order = await Order.create({
      user: user._id,
      items: Array.from({ length: lines }, () => ({
        product: product._id,
        quantity,
        price: 500,
        name: "Wooden Robot",
        status: "pending",
      })),
      subtotal: 500 * lines * quantity,
      totalAmount: 500 * lines * quantity,
      discount: 0,
      offerDiscount: 0,
      couponDiscount: 0,
      cutoffAmount: 0,
      address: {
        name: "Test Recipient",
        street: "1 Test Street",
        city: "Testville",
        state: "Teststate",
        zip: "400001",
        phone: "9000000000",
      },
      paymentMethod: "cod",
      paid: false,
      status: "pending",
      checkoutKey: `key-${Math.random()}`,
      ...overrides,
    });
    return { user, product, order };
  };

  it("cancelling puts the reserved stock back, once", async () => {
    const { user, product, order } = await orderFor({ quantity: 2 });
    const post = client();

    const first = await post(`/account/orders/${order._id}/cancel-reason`, {
      as: user._id,
      json: { cancelReason: "Changed my mind" },
    });
    assert.equal(first.status, 302);

    const after = await Product.findById(product._id);
    assert.equal(after.stock, 6, "the two units reserved are back on the shelf");
    assert.equal(after.sold, 0, "and they are no longer counted as sold");

    const second = await post(`/account/orders/${order._id}/cancel-reason`, { as: user._id });
    assert.equal(second.status, 400, "the same answer as the first refusal");

    const unchanged = await Product.findById(product._id);
    assert.equal(unchanged.stock, 6, "the stock is not given back a second time");
    assert.equal(unchanged.sold, 0);
  });

  it("the reason the shopper gave is kept with the order", async () => {
    const { user, order } = await orderFor();
    await client()(`/account/orders/${order._id}/cancel-reason`, {
      as: user._id,
      json: { cancelReason: "Other", reasonOther: "the dog ate it" },
    });

    const after = await Order.findById(order._id);
    assert.equal(after.cancelReason, "Other - the dog ate it");
    assert.equal(after.cancelledBy, "user");
    assert.ok(after.cancelledAt instanceof Date);
    assert.equal(after.items.every((item) => item.status === "cancelled"), true, "the lines follow the order");
  });

  it("a cash order that was paid on delivery is not a source of credit", async () => {
    const { user, order } = await orderFor({ paymentMethod: "cod", paid: true });
    const wallet = await getOrCreateWallet(user._id);

    const response = await client()(`/account/orders/${order._id}/cancel-reason`, { as: user._id });
    assert.equal(response.status, 302);

    assert.equal(Number((await Wallet.findById(wallet._id)).balance), 0, "no money was taken, so none is given");
    assert.equal(await WalletLedger.countDocuments({ type: "credit" }), 0);

    const after = await Order.findById(order._id);
    assert.equal(after.refund.status, "none", "and the order says so");
  });

  it("an order that was never paid is not refunded", async () => {
    const calls = useFakeGateway();
    const { user, order } = await orderFor({
      paymentMethod: "razorpay",
      paid: false,
      razorpayPaymentId: "pay_never_captured",
    });

    const response = await client()(`/account/orders/${order._id}/cancel-reason`, { as: user._id });
    assert.equal(response.status, 302);
    assert.deepEqual(calls.refunds, [], "the gateway was not asked for a refund it does not owe");
    assert.equal((await Order.findById(order._id)).refund.status, "none");
  });

  it("a card payment is refunded to the card, once", async () => {
    const calls = useFakeGateway();
    const { user, order } = await orderFor({
      paymentMethod: "razorpay",
      paid: true,
      razorpayPaymentId: "pay_captured_1",
      razorpayOrderId: "order_online_1",
      razorpayAmount: 50000,
    });
    const wallet = await getOrCreateWallet(user._id);

    const first = await client()(`/account/orders/${order._id}/cancel-reason`, { as: user._id });
    assert.equal(first.status, 302);

    const after = await Order.findById(order._id);
    assert.equal(after.refund.status, "refunded");
    assert.equal(after.refund.method, "razorpay");
    assert.equal(after.refund.gatewayRefundId, "rfnd_1");
    assert.equal(after.refund.amount, 500);

    assert.equal(calls.refunds.length, 1, "one refund");
    assert.equal(calls.refunds[0].paymentId, "pay_captured_1");
    assert.equal(calls.refunds[0].params.amount, 50000, "the amount in the currency's own unit");

    // The money did not come from a balance here, so no balance appears.
    assert.equal(Number((await Wallet.findById(wallet._id)).balance), 0);

    await client()(`/account/orders/${order._id}/cancel-reason`, { as: user._id });
    assert.equal(calls.refunds.length, 1, "a second cancellation does not refund again");
  });

  it("a payment the gateway has not captured is not refunded", async () => {
    const calls = useFakeGateway({ payment: { status: "created", amount: 0 } });
    const { user, order } = await orderFor({
      paymentMethod: "razorpay",
      paid: true,
      razorpayPaymentId: "pay_pending",
    });

    await client()(`/account/orders/${order._id}/cancel-reason`, { as: user._id });

    assert.deepEqual(calls.refunds, [], "nothing was taken, so nothing is returned");
    const after = await Order.findById(order._id);
    assert.equal(after.refund.status, "failed", "the order records that the refund did not happen");
    assert.equal(after.refund.error, "not_settled", "the order says which state the payment is in");
    assert.equal(after.refund.status, "failed");
  });

  it("a refund the gateway refuses is recorded, so it can be asked again", async () => {
    const calls = useFakeGateway({ refundFails: true });
    const { user, order } = await orderFor({
      paymentMethod: "razorpay",
      paid: true,
      razorpayPaymentId: "pay_captured_2",
    });

    await client()(`/account/orders/${order._id}/cancel-reason`, { as: user._id });
    assert.equal(calls.refunds.length, 1, "the gateway was asked");

    const after = await Order.findById(order._id);
    assert.equal(after.refund.status, "failed", "and the order says it did not happen");
    assert.match(after.refund.error, /will not refund/);

    // A second attempt is not treated as a refund that already happened.
    const { cancelOrder } = await import("../utils/order-transitions.js");
    const retry = await cancelOrder({ orderId: String(order._id), userId: String(user._id) });
    assert.equal(retry.ok, false, "the order is still cancelled, so the request is still refused");
    assert.equal(calls.refunds.length, 1, "and nothing is charged to the gateway twice");

    const { refundOrder } = await import("../utils/order-transitions.js");
    const again = await refundOrder(after, 1000);
    assert.equal(again.refunded, false, "a failed refund can be retried");
  });

  it("a wallet order is refunded to the balance it came out of", async () => {
    const { user, order } = await orderFor({ paymentMethod: "wallet", paid: true });
    const wallet = await getOrCreateWallet(user._id);

    const response = await client()(`/account/orders/${order._id}/cancel-reason`, { as: user._id });
    assert.equal(response.status, 302);

    assert.equal(Number((await Wallet.findById(wallet._id)).balance), 500);
    const entry = await WalletLedger.findOne({ type: "credit" }).lean();
    assert.equal(String(entry.idempotencyKey), `refund:order:${order._id}`);
    assert.equal((await Order.findById(order._id)).refund.method, "wallet");
  });

  it("a delivered order is not given a cancellation", async () => {
    const { user, order } = await orderFor({ status: "delivered", paymentMethod: "razorpay", paid: true });
    const calls = useFakeGateway();

    const response = await client()(`/account/orders/${order._id}/cancel-reason`, { as: user._id });

    assert.equal(response.status, 400);
    assert.match((await response.json()).message, /delivered/);
    assert.equal((await Order.findById(order._id)).status, "delivered", "and it is left alone");
    assert.deepEqual(calls.refunds, []);
  });

  it("an administrator's cancellation returns the same money a shopper's would", async () => {
    const calls = useFakeGateway();
    const { user, product, order } = await orderFor({
      paymentMethod: "razorpay",
      paid: true,
      razorpayPaymentId: "pay_captured_3",
    });

    const response = await client()(`/admin/orders/${order._id}/status`, { json: { status: "cancelled" } });
    assert.equal(response.status, 200);
    assert.match((await response.json()).message, /card/);

    const after = await Order.findById(order._id);
    assert.equal(after.status, "cancelled");
    assert.equal(after.cancelledBy, "admin");
    assert.equal(after.refund.status, "refunded");
    assert.equal(calls.refunds.length, 1);
    assert.equal((await Product.findById(product._id)).stock, 5, "and the reserved unit is back on the shelf");

    // Asking the shop to cancel it again is refused, the same way every time.
    const again = await client()(`/admin/orders/${order._id}/status`, { json: { status: "cancelled" } });
    assert.equal(again.status, 409);
    assert.equal(calls.refunds.length, 1, "and the gateway is not asked twice");
  });

  it("cancelling one line returns that line's share, once", async () => {
    const calls = useFakeGateway();
    const { user, order } = await orderFor({
      paymentMethod: "razorpay",
      paid: true,
      razorpayPaymentId: "pay_two_lines",
      lines: 2,
      totalAmount: 1000,
      subtotal: 1000,
    });

    const post = client();
    const first = await post(`/account/orders/${order._id}/cancel-item`, {
      as: user._id,
      json: { itemId: String(order.items[0]._id) },
    });
    assert.ok(first.status < 400, `cancelling a line: ${first.status}`);

    const after = await Order.findById(order._id);
    assert.equal(after.items[0].status, "cancelled");
    assert.equal(after.items[1].status, "pending");
    assert.equal(after.status, "pending", "one line left is still an open order");
    assert.equal(after.totalAmount, 500, "the line's share comes off the total");
    assert.equal(calls.refunds[0].params.amount, 50000, "half of what was paid");

    // The same line again is the same answer, not a second subtraction.
    const second = await post(`/account/orders/${order._id}/cancel-item`, {
      as: user._id,
      json: { itemId: String(order.items[0]._id) },
    });
    assert.ok(second.status < 400);

    const unchanged = await Order.findById(order._id);
    assert.equal(unchanged.totalAmount, 500, "the total is not reduced twice");
    assert.equal(calls.refunds.length, 1, "and the line is not refunded twice");
  });

  it("two lines out of one order are two refunds, not one", async () => {
    const calls = useFakeGateway();
    const { user, product, order } = await orderFor({
      paymentMethod: "razorpay",
      paid: true,
      razorpayPaymentId: "pay_three_lines",
      lines: 3,
    });

    const post = client();
    for (const wanted of [0, 1]) {
      const response = await post(`/account/orders/${order._id}/cancel-item`, {
        as: user._id,
        json: { itemId: String(order.items[wanted]._id) },
      });
      assert.ok(response.status < 400, `line ${wanted}: ${response.status}`);
    }

    // Each line's share went back, so the total is what is left of the order.
    const after = await Order.findById(order._id);
    assert.equal(after.totalAmount, 500, "one line of three is still to come");
    assert.equal(after.refund.status, "none", "the order itself was not refunded");
    assert.equal(
      after.items.filter((line) => line.refund.status === "refunded").length,
      2,
      "and each line carries its own refund",
    );
    assert.deepEqual(
      calls.refunds.map((call) => call.params.amount),
      [50000, 50000],
      "a third of the amount each time, in the gateway's own unit",
    );

    // The stock came back once per line, and not once per order.
    const after2 = await Product.findById(product._id);
    assert.equal(after2.stock, 6, "two of the three units are back on the shelf");
    assert.equal(after2.sold, 0, "and they are no longer counted as sold");
  });

  it("cancelling the order after a line left returns only the rest", async () => {
    const calls = useFakeGateway();
    const { user, product, order } = await orderFor({
      paymentMethod: "razorpay",
      paid: true,
      razorpayPaymentId: "pay_mixed",
      lines: 2,
    });
    const post = client();

    await post(`/account/orders/${order._id}/cancel-item`, {
      as: user._id,
      json: { itemId: String(order.items[0]._id) },
    });
    assert.equal(calls.refunds.length, 1, "the line's share");

    // The rest of the order is called back as one, for what is left of it.
    const whole = await post(`/account/orders/${order._id}/cancel-reason`, { as: user._id });
    assert.equal(whole.status, 302);

    const after = await Order.findById(order._id);
    assert.equal(after.status, "cancelled");
    assert.equal(after.totalAmount, 500, "what is still owed on it is what was still left");
    assert.deepEqual(
      calls.refunds.map((call) => call.params.amount),
      [50000, 50000],
      "all of it came back, and the line's share came back only once",
    );

    const shelf = await Product.findById(product._id);
    assert.equal(shelf.stock, 6, "both units are back, and the first one only once");
    assert.equal(shelf.sold, 0);
  });

  it("a wallet order's lines go back to the balance one at a time", async () => {
    const { user, order } = await orderFor({ paymentMethod: "wallet", paid: true, lines: 2 });
    const wallet = await getOrCreateWallet(user._id);
    const post = client();

    for (const wanted of [0, 1]) {
      await post(`/account/orders/${order._id}/cancel-item`, {
        as: user._id,
        json: { itemId: String(order.items[wanted]._id) },
      });
    }

    assert.equal(Number((await Wallet.findById(wallet._id)).balance), 1000, "all of it, once per line");
    const entries = await WalletLedger.find({ type: "credit" }).lean();
    assert.equal(entries.length, 2, "and the balance can be read line by line");
    assert.deepEqual(
      entries.map((entry) => entry.idempotencyKey).sort(),
      [
        `refund:order:${order._id}:item:${order.items[0]._id}`,
        `refund:order:${order._id}:item:${order.items[1]._id}`,
      ],
    );
  });

  it("the last line out closes the order and empties the total", async () => {
    const { user, order } = await orderFor({ quantity: 2 });
    const post = client();

    const first = await post(`/account/orders/${order._id}/cancel-item`, {
      as: user._id,
      json: { itemId: String(order.items[0]._id) },
    });
    assert.ok(first.status < 400);

    const after = await Order.findById(order._id);
    assert.equal(after.status, "cancelled", "an order with nothing left is a cancelled order");
    assert.equal(after.totalAmount, 0, "and nothing is owed for it");
  });

  it("a line of a shipped order is not called back", async () => {
    const { user, order } = await orderFor({ status: "shipped" });

    const response = await client()(`/account/orders/${order._id}/cancel-item`, {
      as: user._id,
      json: { itemId: String(order.items[0]._id) },
    });

    assert.equal(response.status, 400);
    assert.match((await response.json()).message, /shipped/);
    assert.equal((await Order.findById(order._id)).items[0].status, "pending");
  });

  it("an order that is not paid yet keeps a payment page it can still use", async () => {
    const { user, order } = await orderFor({
      paymentMethod: "razorpay",
      paid: false,
      razorpayOrderId: "order_online_2",
      razorpayAmount: 100000,
      lines: 2,
    });

    await client()(`/account/orders/${order._id}/cancel-item`, {
      as: user._id,
      json: { itemId: String(order.items[0]._id) },
    });

    const after = await Order.findById(order._id);
    assert.equal(after.razorpayAmount, 50000, "what the gateway is expecting follows the order's new total");
    assert.equal(after.totalAmount, 500);
    assert.equal(after.refund.status, "none", "nothing was paid, so nothing is returned");
  });
});
