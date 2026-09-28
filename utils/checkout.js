import Cart from "../models/cart.models.js";
import Coupon from "../models/couponSchema.models.js";
import {
  applyCoupon as applyCouponByRules,
  releaseCoupon,
  redeemCoupon,
  settleAppliedCoupon as settleCouponByRules,
} from "./coupon-rules.js";
import Order from "../models/orders.models.js";
import Product from "../models/product.models.js";
import { debitWallet as debitWalletLedger } from "./wallet.js";
import { refreshCartTotals } from "./cart-totals.js";
import { CheckoutError } from "./checkout-error.js";

export { CheckoutError };

const MAX_RECEIPT_LENGTH = 40;

const money = (value) => Number(value || 0).toFixed(2);

// A coupon the shopper applied is checked against the shop before it is allowed
// to lower the price, so a blocked, expired, used up or already spent coupon
// stops working on its own. The rules are in utils/coupon-rules.js, so applying
// a coupon and settling one cannot disagree.
const settleAppliedCoupon = (cart, options) => settleCouponByRules(cart, options);

// The cart of the account, priced again from the products themselves, right
// before anything is created. Nothing the request said about prices, discounts
// or totals is read here.
//
// expectedTotal is the total the shopper was looking at. It is never used as an
// amount: it only answers the question whether the page they confirmed is still
// the cart they are buying. A cart that priced differently in the meantime is
// refused with the new total, so the shopper confirms it on the next page load
// instead of being charged a price nobody agreed to.
export const loadPricedCart = async (userId, { expectedTotal, orderId = null } = {}) => {
  const cart = await Cart.findOne({ user: userId }).populate("items.product");
  if (!cart || cart.items.length === 0) {
    throw new CheckoutError(400, "Your cart is empty");
  }

  // A line whose product is gone cannot be bought, and a line whose quantity is
  // not on the shelf cannot be shipped. Both are reported instead of crashing
  // the request further down.
  const lines = [];
  for (const item of cart.items) {
    const product = item.product;
    if (!product) {
      throw new CheckoutError(409, "A product in your cart is no longer available", {
        productId: String(item.product),
      });
    }

    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new CheckoutError(409, `The quantity for ${product.name} is not valid`);
    }

    if (product.stock < quantity) {
      throw new CheckoutError(
        409,
        product.stock < 1
          ? `${product.name} is out of stock`
          : `Only ${product.stock} of ${product.name} can be bought`,
        { productId: String(product._id), available: product.stock },
      );
    }

    lines.push({ product, quantity });
  }

  await settleAppliedCoupon(cart, { userId, orderId });
  await refreshCartTotals(cart);

  const totalAmount = Number(cart.total);
  if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
    throw new CheckoutError(409, "The cart total could not be calculated");
  }

  if (expectedTotal !== undefined && expectedTotal !== null && expectedTotal !== "") {
    if (money(expectedTotal) !== money(totalAmount)) {
      throw new CheckoutError(
        409,
        "The cart total changed since this page was loaded. Please check the new total and try again.",
        { totalChanged: true, totalAmount },
      );
    }
  }

  return { cart, lines, totalAmount };
};

// The coupon the shopper asked for, matched against the shop and applied to the
// cart that was priced from the products. The amount the request carried is
// never used, not for the discount and not for the minimum.
export const applyCouponToCart = async (userId, couponCode) => {
  if (!String(couponCode || "").trim()) {
    throw new CheckoutError(400, "Enter a coupon code.");
  }

  const { cart } = await loadPricedCart(userId);

  // The code comes from the shopper. The discount is worked out here, from the
  // coupon and the cart that was priced from the products.
  const { coupon, discount } = await applyCouponByRules({ userId, couponCode, cart });
  await refreshCartTotals(cart);

  return {
    cart,
    coupon,
    discountAmount: discount,
    totalAmount: Number(cart.total),
    totalBeforeCoupon: Number(cart.subtotal) - Number(cart.discount) - Number(cart.offerDiscount),
  };
};

// Taking a coupon off is a change like applying one: the discount goes, the
// total is priced again, and asking for the same code afterwards gives the
// same answer it gave the first time.
export const removeCouponFromCart = async (userId) => {
  // The products have to be there, because the total is priced again from them
  // and an id in place of a product prices to nothing.
  const cart = await Cart.findOne({ user: userId }).populate("items.product");
  if (!cart) {
    throw new CheckoutError(404, "Your cart is empty");
  }

  cart.appliedCoupon = null;
  cart.couponDiscount = 0;
  await refreshCartTotals(cart);

  return { cart, discountAmount: 0, totalAmount: Number(cart.total) };
};

// A coupon is spent for an order, keyed by that order, so a request that
// repeats the one that placed it finds the redemption already written and
// nothing is taken off the usage count twice. An order that never went through
// gives the coupon back the same way it took it.
export const spendCouponForOrder = async ({ cart, order, userId }) => {
  if (!cart?.appliedCoupon) {
    return null;
  }

  const coupon = await Coupon.findOne({ couponCode: cart.appliedCoupon });
  if (!coupon) {
    return null;
  }

  try {
    return await redeemCoupon({
      coupon,
      userId,
      orderId: order._id,
      amount: Number(cart.couponDiscount) || 0,
    });
  } catch (error) {
    if (error?.code === 11000) {
      // This order already spent this coupon, which is what a repeat of the
      // request that placed it looks like.
      return null;
    }
    throw error;
  }
};

export { redeemCoupon, releaseCoupon };

// Stock is taken with a single conditional update per line, so two checkouts at
// the same time cannot both take the last unit. A line that cannot be taken
// gives back the lines already taken in this request.
//
// A MongoDB transaction would need a replica set, so the guarantee is built
// from the conditional update instead, which holds on a standalone server too.
export const reserveStock = async (lines) => {
  const reserved = [];

  try {
    for (const { product, quantity } of lines) {
      const updated = await Product.findOneAndUpdate(
        { _id: product._id, stock: { $gte: quantity } },
        { $inc: { stock: -quantity, sold: quantity } },
        { new: true },
      );

      if (!updated) {
        throw new CheckoutError(409, `${product.name} just went out of stock`, {
          productId: String(product._id),
        });
      }

      reserved.push({ productId: product._id, quantity });
    }
  } catch (error) {
    await releaseStock(reserved);
    throw error;
  }

  return reserved;
};

// The lines to give back can be a reservation made in this request or the items
// of an order that is being given up, so both shapes are read here.
export const releaseStock = async (lines = []) => {
  for (const line of lines) {
    const productId = line.productId ?? line.product;
    if (!productId || !line.quantity) {
      continue;
    }

    await Product.updateOne(
      { _id: productId },
      { $inc: { stock: line.quantity, sold: -line.quantity } },
    );
  }
};

const receiptFor = (key) =>
  `rcpt_${String(key)}`
    .replace(/[^a-zA-Z0-9_]/g, "")
    .slice(0, MAX_RECEIPT_LENGTH);

// A retry of the same checkout attempt returns the order that attempt already
// created, so a double click cannot become two orders.
export const findOrderByCheckoutKey = async (userId, checkoutKey) => {
  if (!userId || !checkoutKey) {
    return null;
  }
  return Order.findOne({ user: userId, checkoutKey: String(checkoutKey) });
};

export const buildOrder = ({
  user,
  cart,
  lines,
  address,
  paymentMethod,
  paid,
  checkoutKey = null,
}) => ({
  user: user._id,
  items: lines.map(({ product, quantity }) => ({
    product: product._id,
    quantity,
    // The price of the moment, not the price that was on the page.
    price: product.price,
    paymentMethod,
  })),
  subtotal: Number(cart.subtotal),
  discount: Number(cart.discount),
  offerDiscount: Number(cart.offerDiscount),
  couponDiscount: Number(cart.couponDiscount),
  cutoffAmount: Number(cart.cutoffAmount),
  totalAmount: Number(cart.total),
  address: {
    user: {
      name: user.name,
      email: user.email,
      joined_date: user.joined_date,
      phone_number: user.phone_number,
    },
    name: address.name,
    street: address.street,
    city: address.city,
    state: address.state,
    zip: address.zip,
    phone: address.phone,
  },
  paymentMethod,
  // Paid is decided by the server, never by the request.
  paid: Boolean(paid),
  status: "pending",
  checkoutKey: checkoutKey ? String(checkoutKey) : null,
});

export const receiptForCheckoutKey = receiptFor;

// The cart belongs to the order once the order exists, so it is only cleared
// after the order was written.
export const clearPurchasedCart = async (userId) => {
  await Cart.deleteOne({ user: userId });
};

export const recordPurchaseOnUser = async (user, lines) => {
  const units = lines.reduce((total, { quantity }) => total + quantity, 0);

  user.totalProductsBuyed = (Number(user.totalProductsBuyed) || 0) + units;
  await user.save();
};

// A wallet is only debited when the balance is still there, so two checkouts at
// the same time cannot spend the same money twice, and the debit is a ledger
// entry keyed by the order, so paying for one order twice is one debit.
export const debitWallet = async ({ user, amount, description, orderId }) => {
  if (!orderId) {
    throw new CheckoutError(500, "The order could not be written before payment");
  }

  try {
    const { wallet } = await debitWalletLedger({
      userId: user._id,
      amount,
      reason: "order",
      idempotencyKey: `order:${orderId}`,
      reference: { order: orderId },
      description,
    });

    return wallet;
  } catch (error) {
    if (error?.name === "WalletError") {
      throw new CheckoutError(error.status, error.message);
    }
    throw error;
  }
};
