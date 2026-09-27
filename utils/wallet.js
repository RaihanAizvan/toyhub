import Wallet from "../models/wallets.models.js";
import WalletLedger from "../models/walletLedger.models.js";

// A wallet problem the shopper can act on, the way a checkout problem is.
export class WalletError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "WalletError";
    this.status = status;
  }
}

// The balance lives on the wallet document and nowhere else, and the wallet of
// an account is the one that points at that account.
export const getOrCreateWallet = async (userId) => {
  const existing = await Wallet.findOne({ user: userId });
  if (existing) {
    return existing;
  }

  try {
    return await Wallet.create({ user: userId, balance: 0 });
  } catch (error) {
    // Two requests at once both find nothing and both create; the one that lost
    // the race reads the wallet the winner made.
    if (error?.code === 11000) {
      return Wallet.findOne({ user: userId });
    }
    throw error;
  }
};

const money = (value) => Number(value || 0).toFixed(2);

const entryQuery = (wallet, idempotencyKey) => ({
  wallet: wallet._id,
  idempotencyKey: String(idempotencyKey),
});

// One change of the balance, one entry in the ledger, one key.
//
// The entry is written first because its key is unique. The money is only moved
// by the request that claims the entry, so a request that comes back a second
// time waits to see the entry it already made and stops there. An entry that
// never got its money is taken away, because it is not history.
const CLAIM_WAIT_TRIES = 20;
const CLAIM_WAIT_MS = 50;

const readEntry = (id) => WalletLedger.findById(id).lean();

const waitForTheClaimedEntry = async (id) => {
  for (let attempt = 0; attempt < CLAIM_WAIT_TRIES; attempt += 1) {
    const entry = await readEntry(id);
    if (!entry || entry.status !== "applying") {
      return entry;
    }
    await new Promise((resolve) => setTimeout(resolve, CLAIM_WAIT_MS));
  }
  return readEntry(id);
};

const record = async ({
  userId,
  type,
  reason,
  amount,
  idempotencyKey,
  reference = {},
  description = "",
}) => {
  const wallet = await getOrCreateWallet(userId);
  const key = String(idempotencyKey);

  let entry = await WalletLedger.findOne({ wallet: wallet._id, idempotencyKey: key });
  if (entry?.status === "applied") {
    return { wallet, entry, applied: false };
  }

  if (!entry) {
    try {
      entry = await WalletLedger.create({
        user: userId,
        wallet: wallet._id,
        type,
        reason,
        amount,
        reference,
        description,
        idempotencyKey: key,
      });
    } catch (error) {
      if (error?.code !== 11000) {
        throw error;
      }
      // The key is taken, so this change has already been written down.
      entry = await WalletLedger.findOne({ wallet: wallet._id, idempotencyKey: key }).lean();
      if (!entry) {
        throw error;
      }
    }
  }

  const entryId = entry._id;
  const claimed = await WalletLedger.findOneAndUpdate(
    { _id: entryId, status: "pending" },
    { $set: { status: "applying" } },
    { new: true },
  );

  // Somebody else is moving this money, or already has. Either way this request
  // does not move it a second time.
  if (!claimed) {
    const finished = await waitForTheClaimedEntry(entryId);
    if (finished?.status === "applied") {
      const current = await Wallet.findById(wallet._id);
      return { wallet: current, entry: finished, applied: false };
    }
    throw new WalletError(409, "This change to your wallet is already being made");
  }

  // A debit may only take money that is there, and the check is part of the
  // same update, so two debits cannot both see the same balance.
  const filter = type === "debit" ? { _id: wallet._id, balance: { $gte: amount } } : { _id: wallet._id };
  const moved = await Wallet.findOneAndUpdate(
    filter,
    { $inc: { balance: type === "debit" ? -amount : amount } },
    { new: true },
  );

  if (!moved) {
    // Nothing moved, so this entry never happened.
    await WalletLedger.deleteOne({ _id: entryId, status: "applying" });
    throw new WalletError(400, "Your wallet balance is too low for this");
  }

  const applied = await WalletLedger.findOneAndUpdate(
    { _id: entryId, status: "applying" },
    { $set: { status: "applied", balanceAfter: Number(moved.balance), appliedAt: new Date() } },
    { new: true },
  );

  return { wallet: moved, entry: applied, applied: true };
};

export const creditWallet = async ({
  userId,
  amount,
  reason,
  idempotencyKey,
  reference = {},
  description = "",
}) =>
  record({
    userId,
    type: "credit",
    reason,
    amount,
    idempotencyKey,
    reference,
    description,
  });

export const debitWallet = async ({
  userId,
  amount,
  reason,
  idempotencyKey,
  reference = {},
  description = "",
}) =>
  record({
    userId,
    type: "debit",
    reason,
    amount,
    idempotencyKey,
    reference,
    description,
  });

// The history the shopper reads, taken from the same ledger the balance moved
// through.
export const listLedger = async ({ userId, limit = 10, page = 1 }) => {
  const perPage = Math.min(Math.max(Number(limit) || 10, 1), 100);
  const currentPage = Math.max(Number(page) || 1, 1);

  const filter = { user: userId, status: "applied" };
  const [entries, total] = await Promise.all([
    WalletLedger.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((currentPage - 1) * perPage)
      .limit(perPage)
      .lean(),
    WalletLedger.countDocuments(filter),
  ]);

  return {
    entries,
    currentPage,
    total,
    totalPages: Math.max(Math.ceil(total / perPage), 1),
  };
};

// What the ledger says the balance should be, next to what is stored. They are
// the same when nothing was interrupted, and the difference is what an operator
// has to look at.
export const reconcileWallet = async (userId) => {
  const wallet = await getOrCreateWallet(userId);
  const [credits, debits] = await Promise.all([
    WalletLedger.aggregate([
      { $match: { wallet: wallet._id, status: "applied", type: "credit" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    WalletLedger.aggregate([
      { $match: { wallet: wallet._id, status: "applied", type: "debit" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
  ]);

  const credited = Number(credits[0]?.total || 0);
  const debited = Number(debits[0]?.total || 0);
  const fromLedger = Number(money(credited - debited));
  const stored = Number(money(wallet.balance));

  return {
    wallet: wallet._id,
    stored,
    credited: Number(money(credited)),
    debited: Number(money(debited)),
    fromLedger,
    drift: Number(money(stored - fromLedger)),
    balanced: stored === fromLedger,
  };
};
