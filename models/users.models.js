import mongoose, { Schema } from 'mongoose';

const UserSchema = new Schema({
  name: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true,
    unique: true
  },
  phone_number: {
    type: String
  },
  password: {
    type: String
  },
  joined_date: {
    type: Date,
    default: Date.now
  },
  isBlocked: {
    type: Boolean,
    default: false
  },
  verified: {
    type: Boolean,
    default: false
  },
  googleId: {
    type: String
  },
  otp: {
    type: Number
  },
  otpExpires: {
    type: Date
  },
  address: {
    type: Schema.Types.ObjectId,
    ref: 'Address'
  },
  orders: {
    type: Schema.Types.ObjectId,
    ref: 'Orders'
  },
  // Remove wallet reference
  // wallet: { type: Schema.Types.ObjectId, ref: 'Wallet' },  // Reference to Wallet
  coupons: [{
    type: Schema.Types.ObjectId,
    ref: 'Coupon'
  }]  // Reference to Coupons
});

const User = mongoose.model('User', UserSchema);
export default User;