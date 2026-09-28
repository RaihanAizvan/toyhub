import mongoose from "mongoose";

// One redemption of one coupon by one account, written once per order.
//
// A coupon that is only counted on the coupon document can be spent twice by
// two requests that read the same count, and a replay of the request that
// placed the order can spend it again. The unique index on the order is what
// makes a replay a no-op: the second attempt collides and is told the coupon
// was already used for that order, whatever the count says by then.
const couponRedemptionSchema = new mongoose.Schema(
  {
    coupon: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Coupon",
      required: true,
    },
    couponCode: {
      type: String,
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // The order that spent it. One redemption per order, and an order spends at
    // most one coupon.
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true },
);

couponRedemptionSchema.index({ order: 1 }, { unique: true });
couponRedemptionSchema.index({ coupon: 1, user: 1 });

const CouponRedemption = mongoose.model("CouponRedemption", couponRedemptionSchema);

export default CouponRedemption;
