import mongoose, { Schema } from "mongoose";

class LedgerImmutableError extends Error {
  constructor(message) {
    super(message);
    this.name = "LedgerImmutableError";
  }
}

// A wallet ledger entry is a record of one change of one balance. It is written
// once and read forever after, so a line cannot be edited, cannot be taken back
// and cannot be used for a second change.
const WalletLedgerSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    wallet: {
      type: Schema.Types.ObjectId,
      ref: "Wallet",
      required: true,
    },
    // The direction of the change, and the reason for it.
    type: {
      type: String,
      enum: ["credit", "debit"],
      required: true,
    },
    reason: {
      type: String,
      enum: ["topup", "order", "refund"],
      required: true,
    },
    // How much money moved. Always a positive number; the type says which way.
    amount: {
      type: Number,
      required: true,
      validate: {
        validator: (value) => Number.isFinite(value) && value > 0,
        message: "A ledger amount is a positive number",
      },
    },
    description: {
      type: String,
      default: "",
    },
    // What the change was about: the top up, the order, the payment that paid
    // for it. Kept as a plain record because a reference to another collection
    // is only worth as much as that collection's own honesty.
    reference: {
      topup: { type: Schema.Types.ObjectId, ref: "WalletTopup", default: null },
      order: { type: Schema.Types.ObjectId, ref: "Order", default: null },
      razorpayOrderId: { type: String, default: null },
      razorpayPaymentId: { type: String, default: null },
    },
    // One key, one change. This is what makes a request that comes back a
    // second time do nothing the second time.
    idempotencyKey: {
      type: String,
      required: true,
    },
    // An entry is written, then the money moves, then the entry says it did.
    // Only these three fields are ever written after the entry is created.
    status: {
      type: String,
      enum: ["pending", "applying", "applied"],
      default: "pending",
    },
    balanceAfter: {
      type: Number,
      default: null,
    },
    appliedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// The whole point: the same key cannot be used for two changes of one balance.
WalletLedgerSchema.index({ wallet: 1, idempotencyKey: 1 }, { unique: true });

// The history is read newest first for one account, and unfinished entries are
// found by whoever has to finish or report them.
WalletLedgerSchema.index({ user: 1, createdAt: -1 });
WalletLedgerSchema.index({ wallet: 1, status: 1 });

const IMMUTABLE = "A wallet ledger entry is a record and cannot be changed. Add another entry instead.";

// An entry is either still waiting or is being applied right now. Once it has
// been applied it is history, and history does not change.
const UNFINISHED = new Set(["pending", "applying"]);

// The only fields a written entry may ever have changed on it: the state of the
// change, and the timestamp the model itself puts on the insert.
const LEDGER_STATE = new Set(["status", "balanceAfter", "appliedAt", "createdAt"]);

const namesTheUnfinishedEntry = function namesTheUnfinishedEntry() {
  return UNFINISHED.has(this.getFilter?.()?.status);
};

// A write may only move an unfinished entry from one state to the next, and may
// only touch the three fields that say the money moved. Anything that would
// rewrite what happened, how much, or why, is refused.
const onlyAdvancesTheEntry = function onlyAdvancesTheEntry(next) {
  const update = this.getUpdate?.() ?? {};
  const names = new Set();
  let refused = null;

  for (const [operator, payload] of Object.entries(update)) {
    if (operator === "$set" || operator === "$setOnInsert") {
      Object.keys(payload ?? {}).forEach((key) => names.add(key));
      continue;
    }
    refused = new LedgerImmutableError(IMMUTABLE);
  }

  const onlyState = [...names].every((name) => LEDGER_STATE.has(name));
  if (refused || !onlyState || !namesTheUnfinishedEntry.call(this)) {
    return next(refused ?? new LedgerImmutableError(IMMUTABLE));
  }

  return next();
};

// An entry that never got its money is not history, so it can be taken away, but
// only by naming the unfinished state it is being taken away from. An applied
// entry is refused.
const refusesRemovingHistory = function refusesRemovingHistory(next) {
  if (namesTheUnfinishedEntry.call(this)) {
    return next();
  }

  return next(new LedgerImmutableError(IMMUTABLE));
};

const refusesAReplacement = function refusesAReplacement(next) {
  return next(new LedgerImmutableError(IMMUTABLE));
};

WalletLedgerSchema.pre("updateOne", onlyAdvancesTheEntry);
WalletLedgerSchema.pre("findOneAndUpdate", onlyAdvancesTheEntry);
WalletLedgerSchema.pre("replaceOne", refusesAReplacement);
WalletLedgerSchema.pre("findOneAndReplace", refusesAReplacement);
WalletLedgerSchema.pre("deleteOne", refusesRemovingHistory);
WalletLedgerSchema.pre("findOneAndDelete", refusesRemovingHistory);
WalletLedgerSchema.pre("deleteMany", refusesRemovingHistory);

const WalletLedger = mongoose.model("WalletLedger", WalletLedgerSchema);

export { LedgerImmutableError };
export default WalletLedger;
