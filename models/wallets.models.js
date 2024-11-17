import mongoose, { Schema } from 'mongoose';

const WalletSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  balance: {
    type: Number,
    default: 0
  },
  transactions: [{
    amount: {
      type: Number,
      required: true
    },
    date: {
      type: Date,
      default: Date.now
    },
    description: {
      type: String
    }
  }]
});

const Wallet = mongoose.model('Wallet', WalletSchema);
export default Wallet;