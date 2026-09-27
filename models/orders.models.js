import mongoose, { Schema } from "mongoose";

const OrderSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  items: [{
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true
    },
    quantity: {
      type: Number,
      required: true
    },
    price: {
      type: Number,
      required: true,
    },
    paymentMethod: {
      type: String,
      required: true,
      enum: ["razorpay", "cod", "wallet"]
    }
  }],
  totalAmount: {
    type: Number,
    required: true
  },
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
  cutoffAmount: {
    type: Number,
    default: 0
  },
  subtotal: {
    type: Number,
    required: true
  },
  address: {
    user: {
      name: {
        type: String,
        required: true
      },
      email: {
        type: String,
        required: true
      },
      joined_date: {
        type: Date,
        default: Date.now
      },
      phone_number: {
        type: Number,
        required: true
      },
    },
    name: {
      type: String,
      required: true
    },
    street: {
      type: String,
      required: true
    },
    city: {
      type: String,
      required: true
    },
    state: {
      type: String,
      required: true
    },
    zip: {
      type: String,
      required: true
    },
    phone: {
      type: Number,
      required: true
    }
  },
  paymentMethod: {
    type: String,
    required: true
  },
  paid: {
    type: Boolean,
    default: false
  },
  couponCode: {
    type: String,
    default: null
  },
  status: {
    type: String,
    default: 'pending'
  },
  // The key the checkout attempt was made with, so a retry of the same attempt
  // finds the order it already created instead of creating a second one.
  checkoutKey: {
    type: String,
    default: null
  },
  // The gateway order this order is paid with, kept so a payment signature can
  // be tied to this order and to no other.
  razorpayOrderId: {
    type: String,
    default: null
  },
  razorpayPaymentId: {
    type: String,
    default: null
  },
  // The amount the gateway order was created for, in the smallest unit, so the
  // order can be checked against the payment it accepted.
  razorpayAmount: {
    type: Number,
    default: null
  },
  orderDate: {
    type: Date,
    default: Date.now
  }
});

// Only orders that carry a key take part. A sparse index is not enough here: an
// order without a key stores an empty one, and every one of those would collide,
// so the index is restricted to real keys instead.
OrderSchema.index(
  { checkoutKey: 1 },
  { unique: true, partialFilterExpression: { checkoutKey: { $type: "string" } } },
);

const Order = mongoose.model('Order', OrderSchema);
export default Order;
