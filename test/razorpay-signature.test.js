import assert from "node:assert/strict";
import crypto from "node:crypto";
import { describe, it } from "node:test";

import {
  isValidSignature,
  razorpaySecret,
  toPaise,
} from "../utils/razorpay.js";
import { applyTestEnv } from "./helpers/test-env.js";

applyTestEnv();

// The signature is the one thing checkout trusts before it will treat a browser
// message as a payment. The HTTP-level tests prove the order it is accepted for;
// this asks the verifier itself, so a change to the algorithm or the comparison
// is caught here rather than as a payment that quietly stops being accepted.
const sign = (orderId, paymentId, secret = razorpaySecret()) =>
  crypto
    .createHmac("sha256", secret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

const ORDER = "order_test_1";
const PAYMENT = "pay_test_1";

describe("the Razorpay signature check", () => {
  it("accepts a signature the gateway would have made", () => {
    assert.equal(
      isValidSignature({
        razorpayOrderId: ORDER,
        razorpayPaymentId: PAYMENT,
        signature: sign(ORDER, PAYMENT),
      }),
      true,
    );
  });

  it("refuses a signature for a different payment of the same order", () => {
    // A signature ties an order and a payment together. Taking a real one and
    // swapping the payment id is the replay this must refuse.
    assert.equal(
      isValidSignature({
        razorpayOrderId: ORDER,
        razorpayPaymentId: "pay_somebody_else",
        signature: sign(ORDER, PAYMENT),
      }),
      false,
    );
  });

  it("refuses a signature made for a different order", () => {
    assert.equal(
      isValidSignature({
        razorpayOrderId: ORDER,
        razorpayPaymentId: PAYMENT,
        signature: sign("order_stranger", PAYMENT),
      }),
      false,
    );
  });

  it("refuses a signature made under a different secret", () => {
    // The shop's key changed, or this was signed by someone who does not have
    // it. Either way it is not this shop's signature.
    assert.equal(
      isValidSignature({
        razorpayOrderId: ORDER,
        razorpayPaymentId: PAYMENT,
        signature: sign(ORDER, PAYMENT, "not-the-shop-secret"),
      }),
      false,
    );
  });

  it("refuses a tampered or malformed signature without throwing", () => {
    const good = sign(ORDER, PAYMENT);
    const cases = [
      { name: "flipped character", signature: good.slice(0, -1) + (good.endsWith("a") ? "b" : "a") },
      { name: "too short", signature: good.slice(0, 10) },
      { name: "empty", signature: "" },
      { name: "not hex", signature: "z".repeat(good.length) },
    ];

    for (const { name, signature } of cases) {
      assert.equal(
        isValidSignature({ razorpayOrderId: ORDER, razorpayPaymentId: PAYMENT, signature }),
        false,
        name,
      );
    }
  });

  it("refuses anything when a part of the signature is missing", () => {
    const signature = sign(ORDER, PAYMENT);

    assert.equal(isValidSignature({ razorpayPaymentId: PAYMENT, signature }), false);
    assert.equal(isValidSignature({ razorpayOrderId: ORDER, signature }), false);
    assert.equal(
      isValidSignature({ razorpayOrderId: ORDER, razorpayPaymentId: PAYMENT }),
      false,
    );
  });

  it("turns rupees into the smallest unit without losing a paisa", () => {
    assert.equal(toPaise(500), 50000);
    assert.equal(toPaise(12.34), 1234);
    assert.equal(toPaise(0.005), 1);
    assert.equal(toPaise("19.99"), 1999);
    assert.equal(Number.isInteger(toPaise(7.777)), true);
  });
});