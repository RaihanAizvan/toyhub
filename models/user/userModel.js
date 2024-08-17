import mongoose, { Schema } from "mongoose";
const WalletSchema = new mongoose.Schema({
  walletId: { type: String, required: true , unique: true },
  balance: { type: Number, required: true },
  currency: { type: String, required: true }
});

const CouponSchema = new mongoose.Schema({
  couponID: { type: String, required: true , unique: true},
  title: { type: String, required: true },
  discount: { type: Number, required: true },
  expiryDate: { type: Date, required: true }
});

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  phone_number: { type: String },
  password: { type: String, required: true },
  joined_date: { type: Date, default: Date.now },
  isBlocked: { type: String, default: 'Unblocked' },
  googleId: { type: String },
  otp: { type: Number },
  otpExpires: { type: Date },
  address: { type: mongoose.Schema.Types.ObjectId, ref: 'Address' },
  orders: { type: Schema.Types.ObjectId, ref: 'orders' },
  wallet: WalletSchema,
  coupons: [CouponSchema]
});

const User = mongoose.model('User', UserSchema);
export default User;
