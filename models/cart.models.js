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
        required: true
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
    subtotal:{
        type: Number,
        required: true,
    },
    total: {
        type: Number,
        required: true,
        default: 0
    },
}, { timestamps: true });

// Method to calculate subtotal and total
cartSchema.methods.calculateTotals = function() {
    this.subtotal = this.items.reduce((acc, item) => {
        return acc + (item.price * item.quantity);
    }, 0);
    
    this.total = this.subtotal - this.discount;
};

// Pre-save hook to calculate totals before saving
cartSchema.pre('save', function(next) {
    this.calculateTotals();
    next();
});

const Cart = mongoose.model('Cart', cartSchema);

export default Cart;
