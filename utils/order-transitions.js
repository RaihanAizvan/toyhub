import Order, { normaliseOrderStatus } from "../models/orders.models.js";
import { releaseStock } from "./checkout.js";
import { refundGatewayPayment } from "./razorpay.js";
import { creditWallet } from "./wallet.js";
import { isObjectId } from "./ownership.js";

// An order changes state through this file and nowhere else, so the rules about
// which change is allowed are written down once instead of being re-decided by
// each caller. Two things follow from that: a request cannot invent a state the
// list does not have, and a change that has already happened cannot happen
// twice, because the write that records it is conditional on it not having
// happened yet.

export const ORDER_ACTORS = Object.freeze(["user", "admin"]);

// Money is only ever given back for money that was actually taken.
//
//   cod       nothing was taken, so nothing is given
//   wallet     the money left a balance inside this application, so it goes
//              back to that balance
//   razorpay   the money left the shopper's card, so it goes back through the
//              gateway to that card
//
// A cod order is never credited, even if something has marked it paid, and an
// online order that was never paid is never refunded, because refunding it
// would be paying the shopper for an order they did not buy.
export const refundPlanFor = (order, amount) => {
  const value = Math.round(Math.max(0, Number(amount) || 0) * 100) / 100;

  if (value <= 0) {
    return { method: "none", amount: 0, reason: "nothing_to_refund" };
  }
  if (!order.paid) {
    return { method: "none", amount: 0, reason: "not_paid" };
  }
  if (order.paymentMethod === "wallet") {
    return { method: "wallet", amount: value, reason: "store_credit" };
  }
  if (order.paymentMethod === "razorpay") {
    return { method: "razorpay", amount: value, reason: "gateway" };
  }

  return { method: "none", amount: 0, reason: "no_money_taken" };
};

// Which state a whole order may be cancelled from. Once it has left the shop's
// hands it cannot be called back by the shopper, and a cancelled order stays
// cancelled.
export const wholeOrderCancellation = (order) => {
  const status = normaliseOrderStatus(order?.status);

  if (status === "cancelled") {
    return { allowed: false, status, reason: "already_cancelled" };
  }
  if (status === "shipped") {
    return { allowed: false, status, reason: "already_shipped" };
  }
  if (status === "delivered") {
    return { allowed: false, status, reason: "already_delivered" };
  }
  if (!isObjectId(order?.user) || !isObjectId(order?._id)) {
    return { allowed: false, status, reason: "not_an_order" };
  }

  return { allowed: true, status, reason: null };
};

// Which state a single line may be cancelled from. A line is part of the parcel,
// so it follows the parcel: nothing is called back once the order has moved on.
export const lineCancellation = (order) => {
  const status = normaliseOrderStatus(order?.status);

  if (status !== "pending") {
    return { allowed: false, status, reason: `order_is_${status}` };
  }

  return { allowed: true, status, reason: null };
};

// The states an administrator may put an order into from each state, and the
// cancellation is not a plain write: it goes through the same code a shopper's
// cancellation does, so it releases the same stock and returns the same money.
export const ADMIN_TRANSITIONS = Object.freeze({
  pending: ["cancelled", "shipped"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
});

export const adminTransition = (order, next) => {
  const status = normaliseOrderStatus(order?.status);
  const allowed = ADMIN_TRANSITIONS[status] ?? [];

  if (!allowed.includes(next)) {
    return {
      allowed: false,
      status,
      reason: allowed.length ? "not_from_here" : "order_is_closed",
    };
  }

  return { allowed: true, status, reason: null };
};

const refundKey = (order, itemId = null) =>
  itemId
    ? `refund:order:${order._id}:item:${itemId}`
    : `refund:order:${order._id}`;

// The refund is claimed before any money moves, and the claim is conditional on
// the refund not having been made yet. Two requests arriving together therefore
// produce one refund, and a request that arrives after one is refused the same
// way every time.
// A line carries its own claim, because a line coming out of an order is a
// refund of its own share: the order's claim is spent by the first line to use
// it, and the second line would find a refund already made and keep its money.
const NOT_REFUNDED = { $in: ["none", "failed"] };
const UNTOUCHED = [
  { "refund.status": NOT_REFUNDED },
  { refund: { $exists: false } },
  { "refund.status": { $exists: false } },
];
const UNTOUCHED_LINE = [
  { "refund.status": NOT_REFUNDED },
  { refund: { $exists: false } },
  { "refund.status": { $exists: false } },
];

const claimRefund = async (order, plan, itemId = null) => {
  const claimed = itemId
    ? await Order.findOneAndUpdate(
        {
          _id: order._id,
          // The line is matched on its own state, so the claim is made on the
          // line that is being refunded and not on whichever line is first.
          items: { $elemMatch: { _id: itemId, $or: UNTOUCHED_LINE } },
        },
        {
          $set: {
            "items.$.refund.status": "pending",
            "items.$.refund.method": plan.method,
            "items.$.refund.amount": plan.amount,
            "items.$.refund.error": null,
          },
        },
        { new: true },
      )
    : await Order.findOneAndUpdate(
        { _id: order._id, $or: UNTOUCHED },
        {
          $set: {
            "refund.status": "pending",
            "refund.method": plan.method,
            "refund.amount": plan.amount,
            "refund.error": null,
          },
        },
        { new: true },
      );

  if (claimed) {
    return { claimed: true, order: claimed };
  }

  const current = await Order.findById(order._id);
  const note = itemId
    ? (current?.items ?? []).find((line) => String(line._id) === String(itemId))?.refund
    : current?.refund;

  if (note?.status === "refunded") {
    return { claimed: false, done: true, order: current, note };
  }

  return { claimed: false, done: false, order: current, note, busy: note?.status === "pending" };
};

// A line's note is on the line; the order's is on the order.
const refundNoteFor = (order, itemId = null) =>
  itemId
    ? (order?.items ?? []).find((line) => String(line._id) === String(itemId))?.refund
    : order?.refund;

const writeOrder = (order, patch) => Order.updateOne({ _id: order._id }, { $set: patch });

// The note is written through the line when there is one, because that is where
// the claim was made. On the order the fields are given without their path, so
// the path is put back on here.
const writeRefundNote = (order, itemId, patch) =>
  Order.updateOne(
    { _id: order._id, ...(itemId ? { items: { $elemMatch: { _id: itemId } } } : {}) },
    {
      $set: Object.fromEntries(
        Object.entries(patch).map(([field, value]) => [
          itemId ? `items.$.refund.${field}` : `refund.${field}`,
          value,
        ]),
      ),
    },
  );

// Giving the money back, once. Which way it goes is the plan's decision; this
// only carries it out and records what happened, including when it did not
// work, so a later request can tell the difference between "already refunded"
// and "never refunded".
export const refundOrder = async (order, amount, { itemId = null } = {}) => {
  const plan = refundPlanFor(order, amount);

  if (plan.method === "none") {
    return { refunded: false, ...plan };
  }

  const line = itemId ? String(itemId) : null;
  const claim = await claimRefund(order, plan, itemId);
  if (!claim.claimed) {
    if (claim.done) {
      return {
        refunded: true,
        repeated: true,
        method: refundNoteFor(order, line)?.method ?? plan.method,
        amount: refundNoteFor(order, line)?.amount ?? plan.amount,
        gatewayRefundId: refundNoteFor(order, line)?.gatewayRefundId ?? null,
      };
    }
    if (claim.busy) {
      return { refunded: false, busy: true, method: plan.method, amount: plan.amount };
    }
  }

  if (plan.method === "wallet") {
    try {
      // The ledger entry is keyed by the order and the line, so this is once
      // only even if the order above is claimed twice.
      await creditWallet({
        userId: order.user._id ?? order.user,
        amount: plan.amount,
        reason: "refund",
        idempotencyKey: refundKey(order, line),
        reference: { order: order._id, ...(line ? { item: line } : {}) },
        description: `Refund for cancelled order ${order._id}`,
      });
    } catch (error) {
      await writeRefundNote(order, itemId, {
        status: "failed",
        error: String(error?.message ?? error).slice(0, 200),
      });
      throw error;
    }

    await writeRefundNote(order, itemId, { status: "refunded", at: new Date() });

    return { refunded: true, repeated: false, method: "wallet", amount: plan.amount };
  }

  // The gateway is a network service that can be down, and a refund it refuses
  // is not a reason for the cancellation to be reported as failed: the order
  // has already been cancelled, and the shopper needs to be told that. What
  // happens instead is that the note says the refund did not happen, with the
  // reason, so that it can be asked for again.
  let outcome;
  try {
    outcome = await refundGatewayPayment({
      paymentId: order.razorpayPaymentId,
      amount: Math.round(plan.amount * 100),
    });
  } catch (error) {
    outcome = { ok: false, reason: String(error?.message ?? error).slice(0, 200) };
  }

  if (!outcome.ok) {
    await writeRefundNote(order, itemId, { status: "failed", error: outcome.reason });
    return { refunded: false, ...outcome, method: "razorpay", amount: plan.amount };
  }

  await writeRefundNote(order, itemId, {
    status: "refunded",
    gatewayRefundId: outcome.id,
    at: new Date(),
  });

  return {
    refunded: true,
    repeated: false,
    method: "razorpay",
    amount: plan.amount,
    gatewayRefundId: outcome.id,
  };
};

// The stock comes back once, and the marker is written by a conditional update
// so two requests arriving together cannot both put it back.
//
// Each line carries its own marker. A line called back on its own has already
// had its stock returned, so an order cancelled later must not return that line
// a second time: it only returns the lines that are still holding theirs.
export const releaseStockForOrder = async (order) => {
  const holding = (order.items ?? []).filter((line) => !line.stockReleasedAt);
  if (holding.length === 0) {
    return { released: true, repeated: true };
  }

  const claimed = await Order.findOneAndUpdate(
    { _id: order._id, $or: [{ stockReleasedAt: null }, { stockReleasedAt: { $exists: false } }] },
    { $set: { stockReleasedAt: new Date() } },
    { new: true },
  );

  if (!claimed) {
    return { released: true, repeated: true };
  }

  const lines = holding.map((line) => ({ productId: line.product, quantity: line.quantity }));

  try {
    await releaseStock(lines);
    await Order.updateOne(
      { _id: order._id },
      { $set: { "items.$[line].stockReleasedAt": new Date() } },
      { arrayFilters: [{ "line._id": { $in: holding.map((line) => line._id) } }] },
    );
  } catch (error) {
    // The marker is given back so the stock can be released by a later attempt
    // rather than being lost with a "done" note next to it.
    await writeOrder(order, { stockReleasedAt: null });
    throw error;
  }

  return { released: true, repeated: false };
};

// The same, for one line: the line's own marker is the claim, so the same line
// cannot put its stock back twice and the other lines are untouched.
export const releaseStockForLine = async (order, itemId) => {
  const claimed = await Order.findOneAndUpdate(
    {
      _id: order._id,
      items: { $elemMatch: { _id: itemId, stockReleasedAt: null } },
    },
    { $set: { "items.$.stockReleasedAt": new Date() } },
    { new: true },
  );

  if (!claimed) {
    return { released: true, repeated: true };
  }

  const line = (claimed.items ?? []).find((entry) => String(entry._id) === String(itemId));
  if (!line) {
    return { released: true, repeated: true };
  }

  try {
    await releaseStock([{ productId: line.product, quantity: line.quantity }]);
  } catch (error) {
    await Order.updateOne(
      { _id: order._id, items: { $elemMatch: { _id: itemId } } },
      { $set: { "items.$.stockReleasedAt": null } },
    );
    throw error;
  }

  return { released: true, repeated: false };
};

const MONEY_MESSAGE = {
  nothing_to_refund: "There was nothing to refund.",
  not_paid: "No payment was taken for this order, so there is nothing to refund.",
  no_money_taken: "This order was paid on delivery, so no money was taken.",
};

// A shopper cancelling, and an administrator cancelling, are the same act on
// the same order. The only difference is who is allowed to ask, which the route
// decides; this is the act itself.
export const cancelOrder = async ({ orderId, userId = null, actor = "user", reason = null }) => {
  if (!ORDER_ACTORS.includes(actor)) {
    return { ok: false, code: 400, reason: "unknown_actor", message: "Unknown actor." };
  }

  const scope = userId ? { _id: orderId, user: userId } : { _id: orderId };
  const found = await Order.findOne(scope);

  if (!found) {
    return { ok: false, code: 404, reason: "not_found" };
  }

  const eligibility = wholeOrderCancellation(found);
  if (!eligibility.allowed) {
    return {
      ok: false,
      code: 400,
      reason: eligibility.reason,
      status: eligibility.status,
      message: cancellationMessage(eligibility.reason),
    };
  }

  // The one write that decides the outcome. Everything after it is a
  // consequence, and every consequence is written so that repeating it is a
  // no-op.
  const cancelled = await Order.findOneAndUpdate(
    { _id: found._id, status: found.status },
    {
      $set: {
        status: "cancelled",
        cancelReason: String(reason ?? "").trim().slice(0, 500) || null,
        cancelledAt: new Date(),
        cancelledBy: actor,
        "items.$[].status": "cancelled",
      },
    },
    { new: true },
  );

  if (!cancelled) {
    // Another request got there first. Its result is the result.
    return {
      ok: false,
      code: 400,
      reason: "already_cancelled",
      status: "cancelled",
      message: cancellationMessage("already_cancelled"),
    };
  }

  const stock = await releaseStockForOrder(cancelled);
  const refund = await refundOrder(cancelled, cancelled.totalAmount);

  return {
    ok: true,
    code: 200,
    order: cancelled,
    stock,
    refund,
    moneyMessage: refund.refunded
      ? refund.method === "wallet"
        ? "The amount is back in your wallet."
        : "The amount is on its way back to the card you paid with."
      : (MONEY_MESSAGE[refund.reason] ?? null),
  };
};

export const cancellationMessage = (reason) => {
  switch (reason) {
    case "already_cancelled":
      return "This order has already been cancelled.";
    case "already_shipped":
      return "This order has been shipped and can no longer be cancelled. You can return it once it arrives.";
    case "already_delivered":
      return "This order has been delivered. Start a return to send it back.";
    case "not_an_order":
      return "Order not found";
    default:
      return "This order cannot be cancelled at this stage.";
  }
};

// One line of an order is a share of what was paid, so cancelling it returns
// that share and takes it off the order's total.
//
// The share is measured against the lines that are still in the order, not
// against every line it ever had. An order's total is reduced as lines come out,
// so dividing by the original lines would give each later line a smaller and
// smaller share of what was charged, and the last line cancelled would leave a
// remainder that no line ever cost. The discount is therefore spread over what
// is left, which is also what it is worth now.
export const lineShare = (order, item) => {
  const grossOf = (line) => Number(line.price || 0) * Number(line.quantity || 0);
  const open = (order.items ?? []).filter(
    (line) => normaliseOrderStatus(line.status) !== "cancelled",
  );
  const openGross = open.reduce((total, line) => total + grossOf(line), 0);

  if (openGross <= 0) {
    return 0;
  }

  const share = (grossOf(item) / openGross) * Number(order.totalAmount || 0);
  return Math.round(Math.max(0, share) * 100) / 100;
};

export const cancelOrderLine = async ({ orderId, userId, itemId, actor = "user" }) => {
  const found = await Order.findOne({ _id: orderId, user: userId });

  if (!found) {
    return { ok: false, code: 404, reason: "not_found" };
  }

  const item = (found.items ?? []).find((line) => String(line._id) === String(itemId));
  if (!item) {
    return { ok: false, code: 404, reason: "item_not_found" };
  }

  const eligibility = lineCancellation(found);
  if (!eligibility.allowed) {
    return {
      ok: false,
      code: 400,
      reason: eligibility.reason,
      message: lineMessage(eligibility.reason),
    };
  }

  // Cancelling the same line twice is the same outcome once, not a second
  // subtraction from the total.
  if (normaliseOrderStatus(item.status) === "cancelled") {
    return { ok: true, code: 200, repeated: true, order: found, item, refund: { refunded: false, reason: "already_cancelled" } };
  }

  const share = lineShare(found, item);
  const remaining = (found.items ?? []).filter(
    (line) => String(line._id) !== String(itemId),
  );
  const allGone = remaining.every((line) => normaliseOrderStatus(line.status) === "cancelled");
  const nextTotal = allGone
    ? 0
    : Math.round(Math.max(0, Number(found.totalAmount) - share) * 100) / 100;

  const updated = await Order.findOneAndUpdate(
    {
      _id: found._id,
      // The line is claimed by matching it while it is still open, so a second
      // request for the same line matches nothing and changes nothing.
      items: { $elemMatch: { _id: item._id, status: { $ne: "cancelled" } } },
    },
    {
      $set: {
        "items.$[line].status": "cancelled",
        "items.$[line].cancelledAt": new Date(),
        totalAmount: nextTotal,
        ...(allGone ? { status: "cancelled", cancelledAt: new Date(), cancelledBy: actor } : {}),
      },
    },
    { new: true, arrayFilters: [{ "line._id": item._id }] },
  );

  if (!updated) {
    const current = await Order.findById(found._id);
    return { ok: true, code: 200, repeated: true, order: current, item, refund: { refunded: false, reason: "already_cancelled" } };
  }

  // The line's stock is its own: it was reserved for this line, so it goes back
  // when the line does, and the other lines keep theirs.
  const stock = await releaseStockForLine(updated, item._id);
  const refund = await refundOrder(updated, share, { itemId: String(item._id) });

  // An order that is not paid yet has nothing to re-verify, but the amount the
  // gateway is expecting has to follow the order's new total.
  if (!updated.paid && updated.razorpayOrderId) {
    await writeOrder(updated, { razorpayAmount: Math.round(nextTotal * 100) });
  }

  return {
    ok: true,
    code: 200,
    repeated: false,
    order: updated,
    item: updated.items.find((line) => String(line._id) === String(itemId)),
    stock,
    refund,
    moneyMessage: refund.refunded
      ? refund.method === "wallet"
        ? "The amount for that item is back in your wallet."
        : "The amount for that item is on its way back to the card you paid with."
      : (MONEY_MESSAGE[refund.reason] ?? null),
  };
};

export const lineMessage = (reason) => {
  if (reason === "order_is_cancelled") {
    return "This order has already been cancelled.";
  }
  if (reason === "order_is_delivered") {
    return "This order has been delivered. Start a return to send it back.";
  }
  if (reason === "order_is_shipped") {
    return "This order has been shipped and can no longer be changed. You can return it once it arrives.";
  }
  return "This order can no longer be changed.";
};
