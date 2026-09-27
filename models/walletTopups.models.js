import mongoose, { Schema } from "mongoose";

// A top up is a request to add money that the shop wrote down before any
// payment was started. The amount on this document is the amount: the browser
// cannot name a different one later, because the payment is checked against it.
const WalletTopupSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      validate: {
        validator: (value) => Number.isFinite(value) && value > 0,
        message: "A top up amount is a positive number",
      },
    },
    currency: {
      type: String,
      default: "INR",
    },
    status: {
      type: String,
      enum: ["pending", "credited", "failed"],
      default: "pending",
    },
    // The gateway order this top up is paid with, and the payment that settled
    // it. Both are read back from the gateway, never from the request.
    razorpayOrderId: { type: String, default: null },
    razorpayPaymentId: { type: String, default: null },
    ledgerEntry: {
      type: Schema.Types.ObjectId,
      ref: "WalletLedger",
      default: null,
    },
    // A top up nobody paid for is not a top up.
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  { timestamps: true },
);

// The account's own top ups, newest first, and the gateway order of a top up is
// unique because the gateway will not make two of them.
WalletTopupSchema.index({ user: 1, createdAt: -1 });
WalletTopupSchema.index({ razorpayOrderId: 1 }, { unique: true, sparse: true });

const MIN_TOPUP = 10;
const MAX_TOPUP = 100000;
const TOPUP_WINDOW_MINUTES = 30;

export const topUpExpiry = (from = new Date()) =>
  new Date(from.getTime() + TOPUP_WINDOW_MINUTES * 60 * 1000);

export const isTopUpAmountAllowed = (amount) =>
  Number.isFinite(amount) && amount >= MIN_TOPUP && amount <= MAX_TOPUP;

// Rupees are whole on a top up, so there is never a half paise to argue about.
export const normaliseTopUpAmount = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : Number.NaN;
};

const WalletTopup = mongoose.model("WalletTopup", WalletTopupSchema);

export default WalletTopup;
