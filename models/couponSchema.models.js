
import mongoose from 'mongoose';

const couponSchema = new mongoose.Schema({
  couponCode: {
    type: String,
    required: true,
    unique: true,
},
discount: {
    type: Number,
    required: true,
},
minSpend:{
    type:Number,
    default:0,
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
minPurchase: {
    type: Number,
    default: 0,
},
maxDiscount: {
    type: Number,
    default: Infinity,
},
usageLimit: {
    type: Number,
    default: 0,
},
isBlocked: {
    type: Boolean,
    default: false,
},
});

export default mongoose.model('Coupon', couponSchema);
