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
      required: true
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
  address: {
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
