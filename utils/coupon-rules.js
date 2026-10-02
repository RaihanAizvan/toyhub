import Coupon from "../models/couponSchema.models.js";
import CouponRedemption from "../models/coupon-redemptions.models.js";
import { CheckoutError } from "./checkout-error.js";

// A code is matched exactly as it was typed, without regard to case or the
// spaces a shopper put in while copying it. A code of the wrong shape is turned
// away before it reaches a query.
const normaliseCode = (value) => String(value ?? "").trim().toUpperCase();

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,31}$/;

const money = (value) => Number(value || 0).toFixed(2);

// The money a coupon is measured against: what the lines are worth, less what
// the shop has already taken off them. A coupon stacks on top of the product
// and offer discounts, and never on top of a cutoff, which is not a discount
// but the floor the shop keeps for itself.
export const couponBaseAmount = (cart) =>
  Math.max(0, Number(cart.subtotal || 0) - Number(cart.discount || 0) - Number(cart.offerDiscount || 0));

// A coupon carries its minimum under two names, because the shop form asks for
// one and the older data uses the other. Whichever was filled in is the one
// that is honoured, and the stricter of the two.
const couponMinimum = (coupon) =>
  Math.max(Number(coupon.minPurchase) || 0, Number(coupon.minSpend) || 0);

// What a percentage coupon is worth, capped by maxDiscount when the shop set
// one. maxDiscount is stored as a plain number and 0 means no cap, which is
// what an unset cap means everywhere else in the shop.
const couponDiscountFor = (coupon, base) => {
  if (coupon.discountType === "percentage") {
    const raw = (base * Number(coupon.discount || 0)) / 100;
    const cap = Number(coupon.maxDiscount) || 0;
    return cap > 0 ? Math.min(raw, cap) : raw;
  }

  if (coupon.discountType === "fixed") {
    // A fixed discount is worth what it says, and never more than what is left
    // to take off, so a cart can never total less than nothing.
    return Math.min(Number(coupon.discount || 0), base);
  }

  return 0;
};

// Every reason a coupon can be turned away, in one place, and every reason the
// same. A coupon that is unknown, blocked, not started, expired, used up, or
// already spent by this account is refused the same way every time, so a
// shopper cannot learn which of those it was by watching the message change.
export const couponProblem = (coupon, { cart, userId, now = new Date() } = {}) => {
  // The answer is always the same shape: a problem in words, or the amount a
  // coupon is measured against. Returning a bare message on one path and an
  // object on the other is how a refused coupon ends up being applied.
  const refuse = (problem) => ({ problem, base: 0, coupon: coupon ?? null });

  if (!coupon) {
    return refuse("That coupon code is not one of ours.");
  }

  if (coupon.isBlocked) {
    return refuse("That coupon is not available any more.");
  }

  if (coupon.startDate && new Date(coupon.startDate) > now) {
    return refuse("That coupon is not available yet.");
  }

  if (coupon.endDate && new Date(coupon.endDate) < now) {
    return refuse("That coupon has expired.");
  }

  if (Number(coupon.usageLimit) <= 0) {
    return refuse("That coupon has been fully used.");
  }

  if (!cart || cart.items.length === 0) {
    return refuse("Add something to your cart before using a coupon.");
  }

  if (Number(cart.cutoffAmount) > 0) {
    return refuse("A coupon cannot be used on a cart that carries a cutoff amount.");
  }

  const base = couponBaseAmount(cart);
  const minimum = couponMinimum(coupon);
  if (base < minimum) {
    return refuse(`That coupon needs a purchase of at least ₹${money(minimum)}.`);
  }

  // A coupon that names products or categories is only worth anything if the
  // cart holds one of them, and the discount is measured against those lines
  // alone.
  const restricts =
    (Array.isArray(coupon.applicableProducts) && coupon.applicableProducts.length > 0) ||
    (Array.isArray(coupon.applicableCategories) && coupon.applicableCategories.length > 0);

  if (restricts) {
    const ids = new Set((coupon.applicableProducts ?? []).map(String));
    const categories = new Set((coupon.applicableCategories ?? []).map(String));
    const eligible = cart.items.filter((item) => {
      const product = item.product;
      return (
        product &&
        (ids.has(String(product._id)) || categories.has(String(product.category)))
      );
    });

    if (eligible.length === 0) {
      return refuse("That coupon does not apply to anything in your cart.");
    }

    const restrictedBase = eligible.reduce(
      (sum, item) => sum + Number(item.price || 0) * item.quantity,
      0,
    );
    if (restrictedBase < minimum) {
      return refuse(
        `That coupon needs a purchase of at least ₹${money(minimum)} of the products it applies to.`,
      );
    }

    return { problem: null, base: restrictedBase, coupon };
  }

  return { problem: null, base, coupon };
};

// Whether this account has already spent this coupon. A coupon is one use per
// account, so a second order with the same code is refused even when the shop
// has not run out of them.
export const hasAccountUsedCoupon = async ({ coupon, userId, orderId = null }) => {
  if (!coupon || !userId) {
    return false;
  }

  const query = { coupon: coupon._id, user: userId };
  if (orderId) {
    // The order that is being placed right now is not a previous use, even
    // though its redemption may have been written before it was reloaded.
    query.order = { $ne: orderId };
  }

  return Boolean(await CouponRedemption.exists(query));
};

// Apply a coupon to a priced cart, or say why it cannot be applied. The code
// comes from the shopper; the discount is worked out here, from the coupon and
// the cart, and is never read from the request.
export const applyCoupon = async ({ userId, couponCode, cart, orderId = null }) => {
  const code = normaliseCode(couponCode);
  if (!code) {
    throw new CheckoutError(400, "Enter a coupon code.");
  }
  if (!CODE_PATTERN.test(code)) {
    throw new CheckoutError(400, "That coupon code is not one of ours.");
  }

  const coupon = await Coupon.findOne({ couponCode: code });
  const outcome = couponProblem(coupon, { cart, userId });

  if (outcome.problem) {
    throw new CheckoutError(400, outcome.problem);
  }

  if (await hasAccountUsedCoupon({ coupon, userId, orderId })) {
    throw new CheckoutError(400, "You have already used that coupon.");
  }

  const discount = couponDiscountFor(coupon, outcome.base);

  cart.appliedCoupon = code;
  cart.couponDiscount = discount;

  return { coupon, discount, base: outcome.base };
};

// Spend a coupon for an order. The redemption is written first and the usage
// count is taken down with a conditional update in the same breath, so two
// requests racing for the last use cannot both succeed, and a replay of the
// request that placed the order finds the redemption already there.
//
// A MongoDB transaction would need a replica set, so the guarantee is built
// from the unique index and the conditional update instead, which hold on a
// standalone server too.
export const redeemCoupon = async ({ coupon, userId, orderId, amount, session = null }) => {
  // Saved through the document rather than `create`, because `create` given an
  // array answers with an array, and everything below reads this as the one
  // redemption it just wrote.
  const redemption = new CouponRedemption({
    coupon: coupon._id,
    couponCode: coupon.couponCode,
    user: userId,
    order: orderId,
    amount: Number(amount) || 0,
  });
  await redemption.save(session ? { session } : {});

  try {
    const updated = await Coupon.findOneAndUpdate(
      { _id: coupon._id, usageLimit: { $gt: 0 } },
      { $inc: { usageLimit: -1, timesUsed: 1 } },
      { new: true, session },
    );

    if (!updated) {
      // The last use went to somebody else while this order was being written,
      // so this one does not get the discount.
      await CouponRedemption.deleteOne({ _id: redemption._id }, { session });
      throw new CheckoutError(409, "That coupon has just been used up.");
    }
  } catch (error) {
    // Inside a transaction the redemption is rolled back with everything else, so
    // only the unwound path deletes it by hand.
    if (!(error instanceof CheckoutError) && !session) {
      await CouponRedemption.deleteOne({ _id: redemption._id });
    }
    throw error;
  }

  return redemption;
};

// Give a coupon back when the order it was spent on did not go through, so a
// failed payment does not cost the shopper the code they were entitled to.
export const releaseCoupon = async ({ orderId, session = null }) => {
  if (!orderId) {
    return null;
  }

  const redemption = await CouponRedemption.findOneAndDelete({ order: orderId }, { session });
  if (!redemption) {
    return null;
  }

  await Coupon.updateOne(
    { _id: redemption.coupon },
    { $inc: { usageLimit: 1, timesUsed: -1 } },
    { session },
  );
  return redemption;
};

// The coupon a cart is already carrying is checked against the shop again every
// time the cart is priced, so a coupon that has since been blocked, has run
// out, has expired, or has already been spent by this account stops being
// applied on its own. The cart is left priced without it, and the shopper sees
// the truth rather than a discount that cannot be honoured.
export const settleAppliedCoupon = async (cart, { userId, orderId = null } = {}) => {
  if (!cart.appliedCoupon) {
    cart.couponDiscount = 0;
    return null;
  }

  const coupon = await Coupon.findOne({ couponCode: normaliseCode(cart.appliedCoupon) });
  const outcome = couponProblem(coupon, { cart, userId });

  if (outcome.problem || (await hasAccountUsedCoupon({ coupon, userId, orderId }))) {
    cart.appliedCoupon = null;
    cart.couponDiscount = 0;
    return { dropped: true, reason: outcome.problem ?? "You have already used that coupon." };
  }

  // What the cart is worth can change under a coupon that is still valid, so
  // the discount is worked out again rather than trusting the stored number.
  cart.appliedCoupon = coupon.couponCode;
  cart.couponDiscount = couponDiscountFor(coupon, outcome.base);

  return { dropped: false, coupon };
};
