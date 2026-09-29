import mongoose from "mongoose";

// A cart line. This is the whole contract: the product it points at, how many,
// and the money for that line. `price`, `discountPrice` and `offerDiscount` are
// derived from the product every time the cart is read or changed, so they are
// stored for the view to draw and are never believed over the product.
//
// `available` and `unavailableReason` are a reading of the product rather than a
// copy of its stock, so a line whose product has gone or run out can be shown
// with a reason in words instead of throwing on a missing product.
const itemSchema = new mongoose.Schema({
    product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true
    },
    quantity: {
        type: Number,
        required: true,
        default: 1,
        validate: {
            validator: (value) => Number.isInteger(value) && value > 0,
            message: 'A cart line holds a whole number of one or more',
        },
    },
    price: {
        type: Number,
        required: true,
        default: 0,
        min: 0,
    },
    discountPrice: {
        type: Number,
        required: true,
        default: 0,
        min: 0,
    },
    offerDiscount: {
        type: Number,
        required: true,
        default: 0,
        min: 0,
    },
    image: {
        type: String,
        default: null,
    },
    available: {
        type: Boolean,
        required: true,
        default: true,
    },
    unavailableReason: {
        type: String,
        default: null,
    },
}, { _id: false }); // Prevent auto-creating _id for subdocuments

// One cart per account. The totals below are all derived by
// utils/cart-totals.js and are stored so a page can be drawn without pricing
// the cart again; none of them is read as truth by checkout, which prices the
// cart from the products themselves.
const cartSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true
    },
    items: { type: [itemSchema], default: [] },
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
    subtotal: {
        type: Number,
        required: true,
        default: 0
    },
    excludedAmount: {
        type: Number,
        default: 0
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

export { itemSchema };
export default Cart;
