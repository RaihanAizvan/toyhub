
import mongoose from 'mongoose';

// A coupon is a rule the shop wrote down, and every one of these fields is read
// by the server when a shopper tries to use it. Nothing about a coupon is
// decided by the request that presents it.
const couponSchema = new mongoose.Schema({
  couponCode: {
    type: String,
    required: true,
    // The same code in a different case is the same code, so the code is
    // stored in one case and matched the same way every time.
    uppercase: true,
    trim: true,
    match: /^[A-Z0-9][A-Z0-9_-]{1,31}$/,
    unique: true,
  },
  discount: {
    type: Number,
    required: true,
    min: 0,
  },
  // The minimum a cart has to reach. It is named twice in the shop's data, so
  // whichever was filled in is read, and the stricter of the two wins.
  minSpend: {
    type: Number,
    default: 0,
    min: 0,
  },
  minPurchase: {
    type: Number,
    default: 0,
    min: 0,
  },
  discountType: {
    type: String,
    enum: ['percentage', 'fixed'],
    required: true,
  },
  startDate: {
    type: Date,
    required: true,
  },
  endDate: {
    type: Date,
    required: true,
  },
  // A cap on what a percentage coupon is worth. Zero means no cap, which is
  // what an unset cap has always meant in the shop.
  maxDiscount: {
    type: Number,
    default: 0,
    min: 0,
  },
  // How many times the coupon may still be used. It goes down by one each time
  // an order spends it, and reaches zero when the shop has given away as many
  // as it meant to.
  usageLimit: {
    type: Number,
    default: 0,
    min: 0,
  },
  // How many times it has been used, kept separately so an admin editing the
  // number of uses still going is never guessing at how many went already.
  timesUsed: {
    type: Number,
    default: 0,
    min: 0,
  },
  // A coupon that names products or categories only applies to those, and the
  // discount is measured against those lines alone. Empty means any cart.
  applicableProducts: {
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
    default: [],
  },
  applicableCategories: {
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
    default: [],
  },
  isBlocked: {
    type: Boolean,
    default: false,
  },
});

export default mongoose.model('Coupon', couponSchema);
