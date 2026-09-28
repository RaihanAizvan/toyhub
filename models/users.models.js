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
  otpHash: {
    type: String,
    default: null
  },
  otpExpires: {
    type: Date
  },
  otpAttempts: {
    type: Number,
    default: 0
  },
  otpIssuedAt: {
    type: Date
  },
  otpResendAvailableAt: {
    type: Date
  },
  otpResendCount: {
    type: Number,
    default: 0
  },
  otpResendWindowStart: {
    type: Date
  },
  resetPasswordTokenHash: {
    type: String,
    default: null
  },
  resetPasswordExpires: {
    type: Date
  },
  resetPasswordUsedAt: {
    type: Date
  },
  resetPasswordRequestedAt: {
    type: Date
  },
  loginAttempts: {
    type: Number,
    default: 0
  },
  loginLockedUntil: {
    type: Date
  },
  lastLoginAt: {
    type: Date
  },
  totalProductsBuyed:{
    type:Number,
    default:0
  },
  totalAmoutSpended:{
    type:Number,
    default:0
  },
  addresses: [{
    type: Schema.Types.ObjectId,
    ref: 'Address'
  }],
  orders: {
    type: Schema.Types.ObjectId,
    ref: 'Orders'
  },
  wallet: {
    type: Schema.Types.ObjectId,
    ref: 'Wallet'  // Reference to Wallet
  },
  coupons: [{
    type: Schema.Types.ObjectId,
    ref: 'Coupon'
  }],  // Reference to Coupons
  wishlist: [{
    type: Schema.Types.ObjectId,
    ref: 'Product'
  }],
  ratings: [{
    type: Schema.Types.ObjectId,
    ref: 'Rating'
  }]
});

const User = mongoose.model('User', UserSchema);
export default User;