import crypto from "node:crypto";
import Razorpay from "razorpay";

import { readEnv } from "./config.js";

const defaultFactory = () =>
  new Razorpay({
    key_id: readEnv("RAZOR_KEY_ID"),
    key_secret: readEnv("RAZOR_SECRET_ID"),
  });

// The gateway is reached through this module so the checkout can be driven in a
// test without a network, the same way the mailer is injected for the auth
// flows. The credentials are read when a client is built, never at import.
let clientFactory = defaultFactory;

export const setRazorpayFactory = (factory) => {
  clientFactory = typeof factory === "function" ? factory : defaultFactory;
};

export const resetRazorpayFactory = () => {
  clientFactory = defaultFactory;
};

export const razorpaySecret = () => readEnv("RAZOR_SECRET_ID");

// The smallest unit of the currency, so a rupee amount is never turned into a
// fractional paise amount by accident.
export const toPaise = (rupees) => Math.round(Number(rupees) * 100);

export const createGatewayOrder = async ({ amount, receipt }) => {
  const client = clientFactory();
  if (!client?.orders?.create) {
    throw new Error("The payment gateway is not configured");
  }

  const order = await client.orders.create({
    amount,
    currency: "INR",
    receipt,
    payment_capture: 1,
  });

  if (!order?.id) {
    throw new Error("The payment gateway did not return an order");
  }

  return {
    id: order.id,
    amount: Number.isInteger(order.amount) ? order.amount : amount,
    currency: order.currency ?? "INR",
  };
};

// A payment the gateway has actually taken, which is not the same thing as one
// the browser says it made.
const SETTLED = new Set(["captured", "authorized"]);

// The payment is read back from the gateway rather than believed: its status,
// its currency, what it was for and how much it was are all the gateway's own
// answers to questions asked after the fact.
export const fetchGatewayPayment = async (paymentId) => {
  if (!paymentId) {
    return null;
  }

  const client = clientFactory();
  if (!client?.payments?.fetch) {
    throw new Error("The payment gateway is not configured");
  }

  try {
    const payment = await client.payments.fetch(paymentId);
    return payment ?? null;
  } catch (error) {
    // A payment the gateway does not know about is not a payment.
    if (error?.statusCode === 400 || error?.code === "BAD_REQUEST_ERROR") {
      return null;
    }
    throw error;
  }
};

export const isSettledPayment = (payment) => SETTLED.has(payment?.status);

// Everything about a payment that has to line up with what the shop expected.
export const paymentMatches = (payment, { orderId, amount, currency = "INR" }) => {
  if (!isSettledPayment(payment)) {
    return { ok: false, reason: "not_settled", status: payment?.status ?? null };
  }

  if (String(payment.order_id) !== String(orderId)) {
    return { ok: false, reason: "wrong_order" };
  }

  if (Number(payment.amount) !== Number(amount)) {
    return { ok: false, reason: "wrong_amount" };
  }

  if (String(payment.currency) !== String(currency)) {
    return { ok: false, reason: "wrong_currency", currency: payment.currency };
  }

  return { ok: true };
};

// A signature is compared in constant time, and a missing part is a failure
// rather than something to compare against.
export const isValidSignature = ({ razorpayOrderId, razorpayPaymentId, signature }) => {
  const secret = razorpaySecret();
  if (!secret || !razorpayOrderId || !razorpayPaymentId || !signature) {
    return false;
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest("hex");

  const given = Buffer.from(String(signature));
  const wanted = Buffer.from(expected);

  return given.length === wanted.length && crypto.timingSafeEqual(given, wanted);
};
