import mongoose from "mongoose";

// A MongoDB transaction is only available on a replica set or a sharded cluster.
// A standalone server -- which is what a plain `mongod` is, and what a lot of
// small deployments and CI containers run -- refuses `startSession` transactions
// with an error rather than quietly running them unprotected. So the support is
// asked about once, and the answer decides whether a section of checkout can be
// committed together or has to be unwound by hand.
let supportsTransactions;

const detects = async () => {
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    return Boolean(hello.setName || hello.msg === 'isdbgrid');
};

export const canUseTransactions = async () => {
    if (supportsTransactions === undefined) {
        try {
            supportsTransactions = await detects();
        } catch {
            supportsTransactions = false;
        }
    }
    return supportsTransactions;
};

// Used by the test suite to forget an answer learned before a server was
// reconfigured underneath it.
export const resetTransactionSupport = () => {
    supportsTransactions = undefined;
};

// Work that has to be all-or-nothing belongs inside `work`. When the server can
// commit a transaction, `work` runs inside one that is committed when it
// returns and aborted when it throws, and the caller's compensation is not
// needed because nothing was left behind. When it cannot, `work` runs on its own
// and the caller is responsible for putting anything it took back itself,
// which is what the checkout handlers already do.
//
// Either way the caller gets the same answer: on success the work is durable,
// and on a throw nothing was half-written.
export const withTransaction = async (work, { session } = {}) => {
    const useTransactions = session ? true : await canUseTransactions();

    if (!useTransactions) {
        return work(null);
    }

    const activeSession = session ?? (await mongoose.startSession());
    let result;

    try {
        await activeSession.withTransaction(async () => {
            result = await work(activeSession);
        });
        return result;
    } finally {
        if (!session) {
            await activeSession.endSession();
        }
    }
};