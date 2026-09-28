import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import crypto from "node:crypto";
import express from "express";
import expressLayouts from "express-ejs-layouts";
import path from "node:path";
import session from "express-session";
import { fileURLToPath } from "node:url";

import Order from "../models/orders.models.js";
import Product from "../models/product.models.js";
import User from "../models/users.models.js";
import Wallet from "../models/wallets.models.js";
import WalletLedger from "../models/walletLedger.models.js";
import WalletTopup from "../models/walletTopups.models.js";
import { CSRF_HEADER_NAME, exposeCsrfToken, injectCsrfFields, verifyCsrfRequest } from "../utils/csrf.js";
import { resetRazorpayFactory, setRazorpayFactory } from "../utils/razorpay.js";
import {
  WalletError,
  creditWallet,
  debitWallet,
  getOrCreateWallet,
  listLedger,
  reconcileWallet,
} from "../utils/wallet.js";
import { applyTestEnv } from "./helpers/test-env.js";
import { canReachTestDatabase, withTestDatabase } from "./helpers/test-db.js";
import { createOrder, createProduct, createUser, createWallet } from "./helpers/fixtures.js";

applyTestEnv();

const profileRouter = (await import("../routes/profileRoutes.js")).default;

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
      secret: "w".repeat(32),
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
      req.session.user = { id: String(account), name: "Wallet Tester" };
    }
    next();
  });

  app.get("/test/session", (req, res) => {
    res.json({ user: req.session.user ?? null, token: req.session.csrfToken ?? null });
  });

  app.use("/account", profileRouter);

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

// A gateway that answers without a network. `payment` decides what it says
// about a payment, so a test can describe one that settled and one that did not.
const useFakeGateway = ({ fails = false, payment, orderFails = false } = {}) => {
  const calls = [];
  const created = [];
  let sequence = 0;

  setRazorpayFactory(() => ({
    orders: {
      create: async (params) => {
        calls.push(params);
        if (orderFails) {
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

const itWhenReachable = (name, run) => {
  it(name, async (t) => {
    if (!(await canReachTestDatabase())) {
      t.skip("the test database is not reachable");
      return;
    }
    await run(t);
  });
};

// A top up that is waiting for a payment, recorded the way the shop records one.
const pendingTopUp = async (user, overrides = {}) =>
  WalletTopup.create({
    user: user._id,
    amount: 500,
    currency: "INR",
    status: "pending",
    razorpayOrderId: "order_topup_1",
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    ...overrides,
  });

const verificationFor = (topup, paymentId = "pay_topup_1", overrides = {}) => ({
  topUpId: String(topup._id),
  razorpay_order_id: topup.razorpayOrderId,
  razorpay_payment_id: paymentId,
  razorpay_signature: signatureFor(topup.razorpayOrderId, paymentId),
  ...overrides,
});

describe("wallet", () => {
  let server;

  before(async () => {
    server = await startServer();
  });

  after(async () => {
    resetRazorpayFactory();
    await server?.close();
  });

  describe("the balance has one home", () => {
    itWhenReachable("an account has one wallet, and asking twice gives the same one", async () => {
      await withTestDatabase(async () => {
        const user = await createUser();

        const first = await getOrCreateWallet(user._id);
        const second = await getOrCreateWallet(user._id);

        assert.equal(String(first._id), String(second._id), "one wallet per account");
        assert.equal(await Wallet.countDocuments({ user: user._id }), 1);
      });
    });

    itWhenReachable("a user document has no second copy of the balance", async () => {
      await withTestDatabase(async () => {
        const user = await createUser();
        await creditWallet({
          userId: user._id,
          amount: 750,
          reason: "topup",
          idempotencyKey: "topup:only-one",
        });

        const stored = await User.findById(user._id).lean();
        assert.equal("walletBalance" in stored, false, "the balance lives on the wallet");
        assert.equal(stored.walletBalance, undefined);
        assert.equal(Number((await Wallet.findOne({ user: user._id })).balance), 750);
      });
    });

    itWhenReachable("a wallet document holds the balance and no history of its own", async () => {
      await withTestDatabase(async () => {
        const user = await createUser();
        await creditWallet({
          userId: user._id,
          amount: 100,
          reason: "topup",
          idempotencyKey: "topup:history",
        });

        const wallet = await Wallet.findOne({ user: user._id }).lean();
        assert.equal("transactions" in wallet, false, "the history is the ledger");
      });
    });
  });

  describe("adding money", () => {
    itWhenReachable("a request cannot ask for a balance to be credited", async () => {
      await withTestDatabase(async () => {
        const user = await createUser();
        const wallet = await createWallet({ user: user._id, balance: 0 });

        const response = await send(server, "/account/wallet/add-money", {
          as: user._id,
          body: { amount: "100000" },
        });

        assert.equal(response.status, 404, "the route that credited a balance is gone");
        assert.equal((await Wallet.findById(wallet._id)).balance, 0, "no money appeared");
        assert.equal(await WalletLedger.countDocuments({}), 0, "nothing was recorded");
      });
    });

    itWhenReachable("a top up is recorded before a payment is started", async () => {
      useFakeGateway();

      await withTestDatabase(async () => {
        const user = await createUser();

        const response = await send(server, "/account/wallet/top-up", {
          as: user._id,
          body: { amount: "500" },
        });

        assert.equal(response.status, 200);
        assert.equal(response.data.amount, 50000, "the gateway is asked for paise");

        const topup = await WalletTopup.findById(response.data.topUpId);
        assert.equal(Number(topup.amount), 500, "the shop recorded the amount");
        assert.equal(topup.currency, "INR");
        assert.equal(topup.status, "pending");
        assert.equal(topup.razorpayOrderId, response.data.orderId);
        assert.ok(topup.expiresAt > new Date(), "a top up nobody pays for runs out");
        assert.equal((await Wallet.findOne({ user: user._id }))?.balance ?? 0, 0, "no money yet");
      });
    });

    itWhenReachable("an amount outside what the shop accepts is refused", async () => {
      useFakeGateway();

      await withTestDatabase(async () => {
        const user = await createUser();

        for (const amount of ["0", "-50", "5", "9.99", "100001", "notanumber"]) {
          const response = await send(server, "/account/wallet/top-up", {
            as: user._id,
            body: { amount },
          });

          assert.equal(response.status, 400, `${amount} is not payable`);
        }

        assert.equal(await WalletTopup.countDocuments({}), 0, "nothing was recorded to pay");
      });
    });

    itWhenReachable("a top up that the gateway will not take is not left behind", async () => {
      useFakeGateway({ orderFails: true });

      await withTestDatabase(async () => {
        const user = await createUser();

        const response = await send(server, "/account/wallet/top-up", {
          as: user._id,
          body: { amount: "500" },
        });

        assert.equal(response.status, 502);
        assert.equal(await WalletTopup.countDocuments({}), 0, "a top up nobody can pay is not kept");
      });
    });

    itWhenReachable("a confirmed payment adds the money once", async () => {
      useFakeGateway();

      await withTestDatabase(async () => {
        const user = await createUser();
        const created = await send(server, "/account/wallet/top-up", {
          as: user._id,
          body: { amount: "500" },
        });

        const topup = await WalletTopup.findById(created.data.topUpId);
        const response = await send(server, "/account/wallet/top-up/verify", {
          as: user._id,
          body: verificationFor(topup),
        });

        assert.equal(response.status, 200);
        assert.equal(response.data.balance, 500);

        const wallet = await Wallet.findOne({ user: user._id });
        assert.equal(Number(wallet.balance), 500);

        const entries = await WalletLedger.find({ wallet: wallet._id }).lean();
        assert.equal(entries.length, 1, "one line in the ledger");
        assert.equal(entries[0].type, "credit");
        assert.equal(entries[0].reason, "topup");
        assert.equal(Number(entries[0].amount), 500);
        assert.equal(entries[0].status, "applied");
        assert.equal(Number(entries[0].balanceAfter), 500);
        assert.equal(String(entries[0].idempotencyKey), `topup:${topup._id}`);
        assert.equal((await WalletTopup.findById(topup._id)).status, "credited");
      });
    });

    itWhenReachable("the same confirmation twice adds the money once", async () => {
      const gateway = useFakeGateway();

      await withTestDatabase(async () => {
        const user = await createUser();
        const created = await send(server, "/account/wallet/top-up", {
          as: user._id,
          body: { amount: "500" },
        });

        const topup = await WalletTopup.findById(created.data.topUpId);
        const attempt = verificationFor(topup);

        const first = await send(server, "/account/wallet/top-up/verify", {
          as: user._id,
          body: attempt,
        });
        const second = await send(server, "/account/wallet/top-up/verify", {
          as: user._id,
          body: attempt,
        });

        assert.equal(first.status, 200);
        assert.equal(second.status, 200);
        assert.equal(second.data.repeated, true, "the second one says it is a repeat");
        assert.equal(Number((await Wallet.findOne({ user: user._id })).balance), 500, "credited once");
        assert.equal(await WalletLedger.countDocuments({}), 1, "one line in the ledger");
        assert.equal(gateway.fetches.length, 1, "the repeat is answered from the top up");
      });
    });

    itWhenReachable("confirmations arriving together still add the money once", async () => {
      useFakeGateway();

      await withTestDatabase(async () => {
        const user = await createUser();
        const created = await send(server, "/account/wallet/top-up", {
          as: user._id,
          body: { amount: "500" },
        });

        const topup = await WalletTopup.findById(created.data.topUpId);
        const attempt = verificationFor(topup);

        const client = createClient(server, user._id);
        const responses = await Promise.all([
          client("/account/wallet/top-up/verify", { body: attempt }),
          client("/account/wallet/top-up/verify", { body: attempt }),
        ]);

        for (const response of responses) {
          assert.equal(response.status, 200);
        }

        assert.equal(Number((await Wallet.findOne({ user: user._id })).balance), 500, "credited once");
        assert.equal(await WalletLedger.countDocuments({}), 1, "one line in the ledger");
      });
    });

    itWhenReachable("a payment the gateway has never heard of adds nothing", async () => {
      useFakeGateway({ payment: null });

      await withTestDatabase(async () => {
        const user = await createUser();
        const topup = await pendingTopUp(user);

        const response = await send(server, "/account/wallet/top-up/verify", {
          as: user._id,
          body: verificationFor(topup),
        });

        assert.equal(response.status, 400);
        assert.equal((await Wallet.findOne({ user: user._id }))?.balance ?? 0, 0, "no money appeared");
        assert.equal(await WalletLedger.countDocuments({}), 0, "nothing was recorded");
        assert.equal((await WalletTopup.findById(topup._id)).status, "failed");
      });
    });

    itWhenReachable("a payment that did not settle adds nothing", async () => {
      for (const status of ["created", "attempted", "failed", "authorized_pending"]) {
        useFakeGateway({ payment: { status } });

        await withTestDatabase(async () => {
          const user = await createUser();
          const topup = await pendingTopUp(user, {
            razorpayOrderId: `order_${status}`,
          });

          const response = await send(server, "/account/wallet/top-up/verify", {
            as: user._id,
            body: verificationFor(topup, `pay_${status}`, {
              razorpay_order_id: topup.razorpayOrderId,
            }),
          });

          assert.equal(response.status, 400, `${status} is not a payment that settled`);
          assert.equal((await Wallet.findOne({ user: user._id }))?.balance ?? 0, 0);
          assert.equal(await WalletLedger.countDocuments({}), 0);
        });
      }
    });

    itWhenReachable("a payment for a different amount, order or currency adds nothing", async () => {
      const cases = [
        { name: "amount", payment: { amount: 1 } },
        { name: "order", payment: { order_id: "order_somebody_else" } },
        { name: "currency", payment: { currency: "USD" } },
      ];

      for (const { name, payment } of cases) {
        useFakeGateway({ payment });

        await withTestDatabase(async () => {
          const user = await createUser();
          const topup = await pendingTopUp(user, { razorpayOrderId: `order_${name}` });

          const response = await send(server, "/account/wallet/top-up/verify", {
            as: user._id,
            body: verificationFor(topup, `pay_${name}`, {
              razorpay_order_id: topup.razorpayOrderId,
            }),
          });

          assert.equal(response.status, 400, `a payment with the wrong ${name} is not accepted`);
          assert.equal((await Wallet.findOne({ user: user._id }))?.balance ?? 0, 0);
          assert.equal(await WalletLedger.countDocuments({}), 0);
        });
      }
    });

    itWhenReachable("a payment of the wrong amount is not payable for a larger top up", async () => {
      useFakeGateway({ payment: { amount: 100 } });

      await withTestDatabase(async () => {
        const user = await createUser();
        const topup = await pendingTopUp(user, { amount: 500 });

        const response = await send(server, "/account/wallet/top-up/verify", {
          as: user._id,
          body: verificationFor(topup, "pay_small"),
        });

        assert.equal(response.status, 400);
        assert.equal((await Wallet.findOne({ user: user._id }))?.balance ?? 0, 0);
      });
    });

    itWhenReachable("a signature that was not made for this payment adds nothing", async () => {
      useFakeGateway();

      await withTestDatabase(async () => {
        const user = await createUser();
        const topup = await pendingTopUp(user);

        const response = await send(server, "/account/wallet/top-up/verify", {
          as: user._id,
          body: verificationFor(topup, "pay_topup_1", {
            razorpay_signature: crypto.randomBytes(32).toString("hex"),
          }),
        });

        assert.equal(response.status, 400);
        assert.equal((await Wallet.findOne({ user: user._id }))?.balance ?? 0, 0);
        assert.equal(await WalletLedger.countDocuments({}), 0);
      });
    });

    itWhenReachable("a payment cannot pay somebody else's top up", async () => {
      useFakeGateway();

      await withTestDatabase(async () => {
        const owner = await createUser();
        const stranger = await createUser();
        const topup = await pendingTopUp(owner);

        const response = await send(server, "/account/wallet/top-up/verify", {
          as: stranger._id,
          body: verificationFor(topup),
        });

        assert.equal(response.status, 404, "a top up that is not yours answers as missing");
        assert.equal((await Wallet.findOne({ user: owner._id }))?.balance ?? 0, 0);
        assert.equal((await Wallet.findOne({ user: stranger._id }))?.balance ?? 0, 0);
        assert.equal(await WalletLedger.countDocuments({}), 0);
      });
    });

    itWhenReachable("a top up that nobody paid for cannot be paid later", async () => {
      useFakeGateway();

      await withTestDatabase(async () => {
        const user = await createUser();
        const topup = await pendingTopUp(user, { expiresAt: new Date(Date.now() - 1000) });

        const response = await send(server, "/account/wallet/top-up/verify", {
          as: user._id,
          body: verificationFor(topup),
        });

        assert.equal(response.status, 410);
        assert.equal((await Wallet.findOne({ user: user._id }))?.balance ?? 0, 0);
        assert.equal(await WalletLedger.countDocuments({}), 0);
      });
    });

    itWhenReachable("a gateway that cannot be asked credits nothing and says so", async () => {
      useFakeGateway({ fails: true });

      await withTestDatabase(async () => {
        const user = await createUser();
        const topup = await pendingTopUp(user);

        const response = await send(server, "/account/wallet/top-up/verify", {
          as: user._id,
          body: verificationFor(topup),
        });

        assert.equal(response.status, 502);
        assert.equal(response.data.success, false);
        assert.equal((await Wallet.findOne({ user: user._id }))?.balance ?? 0, 0);
        assert.equal(await WalletLedger.countDocuments({}), 0);
        assert.equal(
          (await WalletTopup.findById(topup._id)).status,
          "pending",
          "a payment the shop could not check is not called failed",
        );
      });
    });

    itWhenReachable("an anonymous request cannot start a top up", async () => {
      useFakeGateway();

      await withTestDatabase(async () => {
        const response = await send(server, "/account/wallet/top-up", { body: { amount: "500" } });

        // The account middleware turns an anonymous request away before any
        // money is written down.
        assert.ok(response.status >= 300, "the request is not answered as a success");
        assert.equal(await WalletTopup.countDocuments({}), 0, "nothing was recorded to pay");
        assert.equal(await WalletLedger.countDocuments({}), 0, "nothing was recorded");
      });
    });

    itWhenReachable("an anonymous request cannot confirm a top up", async () => {
      useFakeGateway();

      await withTestDatabase(async () => {
        const owner = await createUser();
        const topup = await pendingTopUp(owner);

        const response = await send(server, "/account/wallet/top-up/verify", {
          body: verificationFor(topup),
        });

        assert.ok(response.status >= 300, "the request is not answered as a success");
        assert.equal((await Wallet.findOne({ user: owner._id }))?.balance ?? 0, 0, "no money appeared");
        assert.equal((await WalletTopup.findById(topup._id)).status, "pending", "the top up waits");
      });
    });
  });

  describe("the ledger cannot be rewritten", () => {
    itWhenReachable("an applied entry cannot be changed", async () => {
      await withTestDatabase(async () => {
        const user = await createUser();
        const { entry } = await creditWallet({
          userId: user._id,
          amount: 400,
          reason: "topup",
          idempotencyKey: "topup:locked",
        });

        await assert.rejects(
          () => WalletLedger.updateOne({ _id: entry._id }, { $set: { amount: 999999 } }).exec(),
          (error) => error?.name === "LedgerImmutableError",
          "the write is refused out loud",
        );

        await assert.rejects(
          () => WalletLedger.findOneAndUpdate({ _id: entry._id }, { $set: { amount: 999999 } }).exec(),
          (error) => error?.name === "LedgerImmutableError",
        );

        await assert.rejects(
          () => WalletLedger.findOneAndReplace({ _id: entry._id }, { amount: 1 }).exec(),
          (error) => error?.name === "LedgerImmutableError",
        );

        assert.equal(await WalletLedger.countDocuments({ _id: entry._id, amount: 400 }), 1);
      });
    });

    itWhenReachable("an applied entry cannot be replaced or removed", async () => {
      await withTestDatabase(async () => {
        const user = await createUser();
        const { entry } = await creditWallet({
          userId: user._id,
          amount: 400,
          reason: "topup",
          idempotencyKey: "topup:kept",
        });

        await assert.rejects(
          () => WalletLedger.findOneAndDelete({ _id: entry._id }).exec(),
          (error) => error?.name === "LedgerImmutableError",
          "a delete that does not name an unfinished entry is refused",
        );

        await assert.rejects(
          () => WalletLedger.deleteOne({ _id: entry._id, status: "applied" }).exec(),
          (error) => error?.name === "LedgerImmutableError",
        );

        const still = await WalletLedger.findById(entry._id).lean();
        assert.equal(Number(still.amount), 400, "the entry is what it was");
      });
    });

    itWhenReachable("a history cannot be wiped", async () => {
      await withTestDatabase(async () => {
        const user = await createUser();
        await creditWallet({
          userId: user._id,
          amount: 400,
          reason: "topup",
          idempotencyKey: "topup:wiped",
        });

        await assert.rejects(
          () => WalletLedger.deleteMany({}).exec(),
          (error) => error?.name === "LedgerImmutableError",
          "a history cannot be wiped",
        );

        assert.equal(await WalletLedger.countDocuments({}), 1, "the history is still there");
      });
    });

    itWhenReachable("the same key cannot be used for two different changes", async () => {
      await withTestDatabase(async () => {
        const user = await createUser();
        const wallet = await getOrCreateWallet(user._id);

        await creditWallet({
          userId: user._id,
          amount: 100,
          reason: "topup",
          idempotencyKey: "topup:once",
        });

        await assert.rejects(
          () =>
            WalletLedger.create({
              user: user._id,
              wallet: wallet._id,
              type: "credit",
              reason: "topup",
              amount: 200,
              idempotencyKey: "topup:once",
            }),
          (error) => error?.code === 11000,
          "the key belongs to one change",
        );

        assert.equal(Number((await Wallet.findById(wallet._id)).balance), 100);
      });
    });

    itWhenReachable("a wallet with no ledger entries has a balance of nothing", async () => {
      await withTestDatabase(async () => {
        const user = await createUser();
        const wallet = await createWallet({ user: user._id, balance: 0 });

        const report = await reconcileWallet(user._id);

        assert.equal(report.balanced, true, "nothing in, nothing out");
        assert.equal(report.stored, 0);
        assert.equal(report.drift, 0);
        assert.equal(String(report.wallet), String(wallet._id));
      });
    });
  });

  describe("spending from a wallet", () => {
    itWhenReachable("a balance is only spent when it is there", async () => {
      await withTestDatabase(async () => {
        const user = await createUser();
        await creditWallet({
          userId: user._id,
          amount: 100,
          reason: "topup",
          idempotencyKey: "topup:spend",
        });

        await assert.rejects(
          () =>
            debitWallet({
              userId: user._id,
              amount: 250,
              reason: "order",
              idempotencyKey: "order:too-big",
            }),
          (error) => error instanceof WalletError && error.status === 400,
        );

        assert.equal(Number((await Wallet.findOne({ user: user._id })).balance), 100, "no money left");
        assert.equal(await WalletLedger.countDocuments({}), 1, "the failed spend left no line");
      });
    });

    itWhenReachable("two spends at once cannot spend the same money twice", async () => {
      await withTestDatabase(async () => {
        const user = await createUser();
        await creditWallet({
          userId: user._id,
          amount: 100,
          reason: "topup",
          idempotencyKey: "topup:race",
        });

        const results = await Promise.allSettled([
          debitWallet({
            userId: user._id,
            amount: 80,
            reason: "order",
            idempotencyKey: "order:first",
          }),
          debitWallet({
            userId: user._id,
            amount: 80,
            reason: "order",
            idempotencyKey: "order:second",
          }),
        ]);

        const spent = results.filter((result) => result.status === "fulfilled");
        assert.equal(spent.length, 1, "one of them found the money");
        assert.equal(Number((await Wallet.findOne({ user: user._id })).balance), 20);
        assert.equal(await WalletLedger.countDocuments({ type: "debit" }), 1, "one line for the spend");
      });
    });

    itWhenReachable("paying for one order twice spends the money once", async () => {
      await withTestDatabase(async () => {
        const user = await createUser();
        await creditWallet({
          userId: user._id,
          amount: 500,
          reason: "topup",
          idempotencyKey: "topup:order-twice",
        });

        const attempt = {
          userId: user._id,
          amount: 500,
          reason: "order",
          idempotencyKey: "order:same-order",
        };

        await debitWallet(attempt);
        await debitWallet(attempt);

        assert.equal(Number((await Wallet.findOne({ user: user._id })).balance), 0, "spent once");
        assert.equal(await WalletLedger.countDocuments({}), 2, "the top up and one spend");
      });
    });

    itWhenReachable("the balance and the ledger agree after spending", async () => {
      await withTestDatabase(async () => {
        const user = await createUser();
        await creditWallet({
          userId: user._id,
          amount: 1000,
          reason: "topup",
          idempotencyKey: "topup:agree",
        });
        await debitWallet({
          userId: user._id,
          amount: 250,
          reason: "order",
          idempotencyKey: "order:agree",
        });
        await creditWallet({
          userId: user._id,
          amount: 25,
          reason: "refund",
          idempotencyKey: "refund:order:agree",
        });

        const report = await reconcileWallet(user._id);
        assert.equal(report.balanced, true, `the ledger says ${report.fromLedger} and the wallet says ${report.stored}`);
        assert.equal(report.stored, 775);
        assert.equal(report.drift, 0);
      });
    });
  });

  describe("refunds", () => {
    itWhenReachable("cancelling an order gives the money back once", async () => {
      await withTestDatabase(async () => {
        const user = await createUser();
        const product = await createProduct({ stock: 5 });
        const wallet = await getOrCreateWallet(user._id);
        const order = await createOrder({
          user: user._id,
          paymentMethod: "razorpay",
          paid: true,
          totalAmount: 300,
          status: "Pending",
          items: [
            {
              product: product._id,
              quantity: 1,
              price: 300,
              discountPrice: 0,
              paymentMethod: "razorpay",
            },
          ],
        });

        const first = await send(server, `/account/orders/${order._id}/cancel-reason`, {
          as: user._id,
          body: { reason: "changed my mind" },
        });
        const second = await send(server, `/account/orders/${order._id}/cancel-reason`, {
          as: user._id,
          body: { reason: "changed my mind" },
        });

        assert.equal(first.status, 302);
        assert.equal(second.status, 400, "an order can only be cancelled once");
        assert.equal(Number((await Wallet.findById(wallet._id)).balance), 300, "given back once");
        assert.equal(await WalletLedger.countDocuments({ type: "credit" }), 1, "one line in the ledger");

        const entry = await WalletLedger.findOne({ type: "credit" }).lean();
        assert.equal(entry.reason, "refund");
        assert.equal(String(entry.idempotencyKey), `refund:order:${order._id}`);
        assert.equal(String(entry.reference.order), String(order._id));
      });
    });

    itWhenReachable("the refund is in the ledger even when it was asked for twice directly", async () => {
      await withTestDatabase(async () => {
        const user = await createUser();
        const order = await createOrder({ user: user._id, totalAmount: 700, paid: true });

        const attempt = {
          userId: user._id,
          amount: 700,
          reason: "refund",
          idempotencyKey: `refund:order:${order._id}`,
          reference: { order: order._id },
        };

        await creditWallet(attempt);
        await creditWallet(attempt);

        assert.equal(Number((await Wallet.findOne({ user: user._id })).balance), 700, "given back once");
        assert.equal(await WalletLedger.countDocuments({ type: "credit" }), 1);
      });
    });
  });

  describe("reading a wallet", () => {
    itWhenReachable("the history is the ledger, newest first, and it paginates", async () => {
      await withTestDatabase(async () => {
        const user = await createUser();

        for (let index = 1; index <= 12; index += 1) {
          await creditWallet({
            userId: user._id,
            amount: index,
            reason: "topup",
            idempotencyKey: `topup:page-${index}`,
          });
        }

        const first = await listLedger({ userId: user._id });
        assert.equal(first.entries.length, 10, "ten lines on a page");
        assert.equal(first.total, 12);
        assert.equal(first.totalPages, 2);
        assert.equal(Number(first.entries[0].amount), 12, "the newest is first");

        const second = await listLedger({ userId: user._id, page: 2 });
        assert.equal(second.entries.length, 2);
        assert.equal(Number(second.entries[0].amount), 2);
      });
    });

    itWhenReachable("one account cannot read another account's history", async () => {
      await withTestDatabase(async () => {
        const owner = await createUser();
        const stranger = await createUser();
        await creditWallet({
          userId: owner._id,
          amount: 100,
          reason: "topup",
          idempotencyKey: "topup:private",
        });

        const read = await listLedger({ userId: stranger._id });
        assert.equal(read.total, 0, "another account's money is not history");
      });
    });

    itWhenReachable("the wallet page reads the wallet and the ledger", async () => {
      useFakeGateway();

      await withTestDatabase(async () => {
        const user = await createUser();
        await creditWallet({
          userId: user._id,
          amount: 640,
          reason: "topup",
          idempotencyKey: "topup:page",
          description: "Added money to wallet",
        });

        const response = await send(server, "/account/wallet", { method: "GET", as: user._id });

        assert.equal(response.status, 200);
        assert.match(response.text, /640\.00/, "the balance is on the page");
        assert.match(response.text, /Added money to wallet/, "the ledger line is on the page");
      });
    });

    itWhenReachable("the page asks for a payment rather than crediting a balance", async () => {
      useFakeGateway();

      await withTestDatabase(async () => {
        const user = await createUser();
        const response = await send(server, "/account/wallet", { method: "GET", as: user._id });

        assert.equal(response.status, 200);
        assert.match(response.text, /checkout\.razorpay\.com|razorpay/i, "the card is what adds money");
        assert.doesNotMatch(response.text, /wallet\/add-money/, "the request that credited a balance is gone");
      });
    });

    itWhenReachable("the reconciliation answer names the balance and what the ledger says", async () => {
      await withTestDatabase(async () => {
        const user = await createUser();
        await creditWallet({
          userId: user._id,
          amount: 250,
          reason: "topup",
          idempotencyKey: "topup:report",
        });

        const response = await send(server, "/account/wallet/reconciliation", {
          method: "GET",
          as: user._id,
        });

        assert.equal(response.status, 200);
        assert.equal(response.data.success, true);
        assert.equal(response.data.balanced, true);
        assert.equal(response.data.stored, 250);
        assert.equal(response.data.fromLedger, 250);
        assert.equal(response.data.drift, 0);
      });
    });

    itWhenReachable("a balance that was changed outside the ledger is reported as drift", async () => {
      await withTestDatabase(async () => {
        const user = await createUser();
        const wallet = await getOrCreateWallet(user._id);
        await creditWallet({
          userId: user._id,
          amount: 250,
          reason: "topup",
          idempotencyKey: "topup:drift",
        });

        // Somebody writes to the balance with nothing else, the way the second
        // copy of the balance used to be able to.
        await Wallet.updateOne({ _id: wallet._id }, { $inc: { balance: 100 } });

        const report = await reconcileWallet(user._id);
        assert.equal(report.balanced, false, "the two disagree and it is said out loud");
        assert.equal(report.stored, 350);
        assert.equal(report.fromLedger, 250);
        assert.equal(report.drift, 100);

        const response = await send(server, "/account/wallet/reconciliation", {
          method: "GET",
          as: user._id,
        });
        assert.equal(response.data.balanced, false);
        assert.equal(response.data.drift, 100);
      });
    });
  });
});
