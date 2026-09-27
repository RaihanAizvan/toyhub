import assert from "node:assert/strict";
import { describe, it } from "node:test";
import mongoose from "mongoose";
import Address from "../models/address.models.js";
import AdminUser from "../models/admin.models.js";
import Cart from "../models/cart.models.js";
import Category from "../models/categories.model.js";
import Coupon from "../models/couponSchema.models.js";
import Offer from "../models/offers.models.js";
import Order from "../models/orders.models.js";
import Product from "../models/product.models.js";
import Rating from "../models/ratings.models.js";
import User from "../models/users.models.js";
import Wallet from "../models/wallets.models.js";
import Wishlist from "../models/wishlist.models.js";
import {
  buildAddress,
  buildAdmin,
  buildCart,
  buildCategory,
  buildCoupon,
  buildOffer,
  buildOrder,
  buildPayment,
  buildProduct,
  buildRating,
  buildUser,
  buildWallet,
  buildWishlist,
  hashPassword,
} from "./helpers/fixtures.js";
import {
  applyTestEnv,
  assertIsolatedTestUri,
  buildTestEnv,
  databaseNameFromUri,
} from "./helpers/test-env.js";
import {
  canReachTestDatabase,
  connectTestDatabase,
  createAddress,
  createCart,
  createCoupon,
  createOrder,
  createProduct,
  createUser,
  disconnectTestDatabase,
  withTestDatabase,
} from "./helpers/index.js";

applyTestEnv();

const validationError = (Model, doc) => {
  const error = new Model(doc).validateSync();
  return error ? error.message : null;
};

describe("test environment", () => {
  it("provides every required variable without production credentials", () => {
    const env = buildTestEnv();
    for (const [name, value] of Object.entries(env)) {
      assert.ok(value, `${name} must be set for tests`);
    }
    assert.equal(env.NODE_ENV, "test");
    assert.match(env.MAIL_USER, /@example\.invalid$/);
  });

  it("refuses a MongoDB URI that is not an isolated test database", () => {
    assert.throws(
      () => assertIsolatedTestUri("mongodb://127.0.0.1:27017/toyhub"),
      /must contain "test"/,
    );
    assert.throws(
      () => assertIsolatedTestUri("mongodb://127.0.0.1:27017/"),
      /without a database name/,
    );
    assert.equal(
      databaseNameFromUri("mongodb://127.0.0.1:27017/toyhub-test?retryWrites=true"),
      "toyhub-test",
    );
    assert.equal(
      assertIsolatedTestUri("mongodb://127.0.0.1:27017/toyhub-test"),
      "toyhub-test",
    );
  });
});

describe("shared fixtures", () => {
  it("builds documents that satisfy every model schema", () => {
    assert.equal(validationError(User, buildUser()), null);
    assert.equal(validationError(AdminUser, buildAdmin()), null);
    assert.equal(validationError(Category, buildCategory()), null);
    assert.equal(validationError(Product, buildProduct()), null);
    assert.equal(validationError(Address, buildAddress()), null);
    assert.equal(validationError(Cart, buildCart()), null);
    assert.equal(validationError(Coupon, buildCoupon()), null);
    assert.equal(validationError(Offer, buildOffer()), null);
    assert.equal(validationError(Order, buildOrder()), null);
    assert.equal(validationError(Wallet, buildWallet()), null);
    assert.equal(validationError(Rating, buildRating()), null);
    assert.equal(validationError(Wishlist, buildWishlist()), null);
  });

  it("keeps every generated identifier unique", () => {
    assert.notEqual(buildUser().email, buildUser().email);
    assert.notEqual(buildProduct().name, buildProduct().name);
    assert.notEqual(buildCoupon().couponCode, buildCoupon().couponCode);
  });

  it("describes a verified payment and a wallet balance", () => {
    const payment = buildPayment();
    assert.equal(payment.method, "razorpay");
    assert.ok(payment.razorpayOrderId.startsWith("order_"));
    assert.ok(payment.razorpayPaymentId.startsWith("pay_"));
    assert.equal(payment.paid, true);

    const wallet = buildWallet({ balance: 250, transactions: [{ amount: 250 }] });
    assert.equal(wallet.balance, 250);
    assert.equal(wallet.transactions.length, 1);
  });

  it("hashes fixture passwords instead of storing plaintext", async () => {
    const hash = await hashPassword("TestPassw0rd!");
    assert.match(hash, /^\$2[aby]\$04\$/);
  });
});

describe("fixture persistence", () => {
  it("writes fixtures into the isolated test database", async (t) => {
    if (!(await canReachTestDatabase())) {
      t.skip(
        "no MongoDB on the test URI; set TEST_MONGO_URI or run a local mongod to exercise this test",
      );
      return;
    }

    await withTestDatabase(async ({ name, uri }) => {
      t.diagnostic(`using isolated test database ${name} at ${uri}`);

      const user = await createUser();
      const product = await createProduct();
      const address = await createAddress({ user: user._id });
      const coupon = await createCoupon();
      const order = await createOrder({
        user: user._id,
        items: [{ product: product._id, quantity: 2, price: 500, paymentMethod: "cod" }],
      });
      const cart = await createCart({
        user: user._id,
        items: [{ product: product._id, quantity: 2, price: 500, discountPrice: 500 }],
      });

      assert.match(user.password, /^\$2[aby]\$/);
      assert.equal(order.user.toString(), user._id.toString());
      assert.equal(address.user.toString(), user._id.toString());
      assert.equal(cart.subtotal, 1000);
      assert.equal(cart.total, 1000);
      assert.equal(coupon.couponCode, coupon.couponCode.toUpperCase());
      assert.equal(await User.countDocuments(), 1);
    });
  });

  it("clears every collection between runs", async (t) => {
    if (!(await canReachTestDatabase())) {
      t.skip("no MongoDB on the test URI");
      return;
    }

    await withTestDatabase(async () => {
      await createUser();
      await createProduct();
      assert.ok((await User.countDocuments()) > 0);

      const second = await withTestDatabase(async () => {
        return User.countDocuments();
      });
      assert.equal(second, 0);
    });
  });
});
