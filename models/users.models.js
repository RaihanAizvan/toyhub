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
  walletBalance: {
    type: Number,
    default: 0
  },
  coupons: [{
    type: Schema.Types.ObjectId,
    ref: 'Coupon'
  }],  // Reference to Coupons
  wishlist: [{
    type: Schema.Types.ObjectId,
    ref: 'Product'
  }]
});

const User = mongoose.model('User', UserSchema);
export default User;