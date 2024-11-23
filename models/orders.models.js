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
  orderDate: {
    type: Date,
    default: Date.now
  }
});

const Order = mongoose.model('Order', OrderSchema);
export default Order;
