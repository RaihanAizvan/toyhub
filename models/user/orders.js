import mongoose, { Schema } from "mongoose";

const OrderSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  products: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true }],
  address: { type: mongoose.Schema.Types.ObjectId, ref: 'Address', required: true },
  date: { type: Date, default: Date.now },
  status: { type: String, required: true },
  totalAmount: { type: Number, required: true }
});

const Order = mongoose.model('Order', OrderSchema);
export default Order;
