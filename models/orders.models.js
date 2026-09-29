import mongoose, { Schema } from "mongoose";

// An order is read in four places: the shopper's history, the shopper's detail
// page, the invoice, and the shop's reports. Those four read one shape, so the
// shape is written down here and the words a status can take are a list rather
// than whatever string a request happened to carry.
export const ORDER_STATUSES = ["pending", "cancelled", "shipped", "delivered"];

export const PAYMENT_METHODS = ["razorpay", "cod", "wallet"];

// Orders written before the list existed spelled the same three states three
// ways: "Cancelled", "cancelled", and "completed" all meant one order state, and
// "Delivered" was a capital D. Reading an old order through this turns whatever
// it says into the word everything now says, so no page has to know the history
// of the field to decide whether an order is still open.
const STATUS_ALIASES = new Map([
  ["pending", "pending"],
  ["cancelled", "cancelled"],
  ["canceled", "cancelled"],
  ["complete", "cancelled"],
  ["completed", "cancelled"],
  ["shipped", "shipped"],
  ["dispatched", "shipped"],
  ["delivered", "delivered"],
  ["stock-unavailable", "cancelled"],
]);

// An order written before the list existed still has to be readable, so every
// read of an old order's status goes through here. An order states it does not
// recognise is pending, which is the only state that can be acted on.
export const normaliseOrderStatus = (status) =>
  STATUS_ALIASES.get(String(status ?? "").trim().toLowerCase()) ?? "pending";

// An order is the one place that records what was bought, so it is the one
// place that keeps a note of when. The admin list sorts by it.
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
    // A line can be cancelled on its own while the rest of the order is
    // fulfilled, so a line carries its own state as well as the order's.
    status: {
      type: String,
      enum: ORDER_STATUSES,
      default: "pending"
    },
    // When a line was called back on its own.
    cancelledAt: {
      type: Date,
      default: null
    },
    // A line is refunded and its stock released on its own, so it keeps its own
    // notes about both. The order's own notes are about the whole order, and a
    // line cancelled on its own does not go through them: two lines coming out
    // of one order are two refunds, not one.
    stockReleasedAt: {
      type: Date,
      default: null
    },
    refund: {
      status: {
        type: String,
        enum: ["none", "pending", "refunded", "failed"],
        default: "none"
      },
      method: {
        type: String,
        enum: ["none", "razorpay", "wallet"],
        default: "none"
      },
      amount: {
        type: Number,
        default: 0
      },
      gatewayRefundId: {
        type: String,
        default: null
      },
      at: {
        type: Date,
        default: null
      },
      error: {
        type: String,
        default: null
      }
    },
    // A product that has since been deleted is not a reason to lose the line,
    // so the name and the picture of the moment are kept with it.
    name: {
      type: String,
      default: null
    },
    image: {
      type: String,
      default: null
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
  // Where it was sent, and nothing else. Who bought it is on the order, as
  // "user", which is a reference and not a copy. This used to hold a second
  // copy of the buyer under the same name, with the User model's own field
  // names inside it, and a phone number stored as a number.
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
    // A phone number is a string. As a number it loses a leading zero and
    // cannot hold a country code.
    phone: {
      type: String,
      required: true
    }
  },
  // The payment method belongs to the order, not to each line: it is chosen
  // once, at checkout, for the whole basket. A per-line copy was required on
  // every item and read from none of them.
  paymentMethod: {
    type: String,
    required: true,
    enum: PAYMENT_METHODS
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
    enum: ORDER_STATUSES,
    default: 'pending'
  },
  // Who called the order back, when, and why. The reason is the one the shopper
  // gave, which the form has always collected and the order has never kept.
  cancelReason: {
    type: String,
    default: null,
    maxlength: 500
  },
  cancelledAt: {
    type: Date,
    default: null
  },
  cancelledBy: {
    type: String,
    enum: ["user", "admin"],
    default: null
  },
  // When the reserved stock was put back on the shelf. Written once, by a
  // conditional update, so the same units cannot be given back twice.
  stockReleasedAt: {
    type: Date,
    default: null
  },
  // What happened to the money, and which way it went. The note is claimed
  // before any money moves, so one refund is made however many requests arrive.
  refund: {
    status: {
      type: String,
      enum: ["none", "pending", "refunded", "failed"],
      default: "none"
    },
    method: {
      type: String,
      enum: ["none", "razorpay", "wallet"],
      default: "none"
    },
    amount: {
      type: Number,
      default: 0
    },
    gatewayRefundId: {
      type: String,
      default: null
    },
    at: {
      type: Date,
      default: null
    },
    error: {
      type: String,
      default: null
    }
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
}, { timestamps: true });

// Only orders that carry a key take part. A sparse index is not enough here: an
// order without a key stores an empty one, and every one of those would collide,
// so the index is restricted to real keys instead.
OrderSchema.index(
  { checkoutKey: 1 },
  { unique: true, partialFilterExpression: { checkoutKey: { $type: "string" } } },
);

const Order = mongoose.model('Order', OrderSchema);
export default Order;
