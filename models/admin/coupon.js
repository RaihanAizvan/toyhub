import mongoose from "mongoose";

const couponSchema = new mongoose.Schema({
    title: { type: String, required: true },
    adminNotes: { type: String },
    amount: { type: Number, required: true },
    couponCode: { type: String, required: true },
    expiryDate: { type: Date, required: true },
    appliedUsers: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminUser' }
});

const Coupon = mongoose.model('Coupon', couponSchema);

export default Coupon;