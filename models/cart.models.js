import mongoose from "mongoose";

const itemSchema = new mongoose.Schema({
    product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true
    },
    quantity: {
        type: Number,
        required: true,
        default: 1
    },
    price: {
        type: Number,
        required: true,
        default:0
    },
    discountPrice: {
        type: Number,
        required: true
    },
    image: {
        type: String,
        required: false
    }
}, { _id: false }); // Prevent auto-creating _id for subdocuments

const cartSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true
    },
    items: [itemSchema],
    discount: {
        type: Number,
        default: 0
    },
    offerDiscount: {
        type: Number,
        default: 0
    },
    couponDiscount: {
        type: Number,
        default: 0
    },
    subtotal:{
        type: Number,
        required: true,
        default:0
    },
    total: {
        type: Number,
        required: true,
        default: 0
    },
    cutoffAmount: {
        type: Number,
        default: 0
    },
    appliedCoupon: {
        type: String,
        default: null
    }
}, { timestamps: true });


const Cart = mongoose.model('Cart', cartSchema);

export default Cart;
