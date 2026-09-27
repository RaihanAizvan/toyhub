import mongoose, { Schema } from 'mongoose';

// The balance lives here and nowhere else. The history of how it got here is
// the ledger, which cannot be rewritten, so this document has nothing to record
// and nothing that can disagree with the ledger.
const WalletSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    // One wallet per account: the balance of an account is a single number, and
    // two documents holding it is the problem this index prevents.
    index: true,
    unique: true
  },
  balance: {
    type: Number,
    default: 0
  }
});

const Wallet = mongoose.model('Wallet', WalletSchema);
export default Wallet;