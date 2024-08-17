import mongoose, { Schema } from "mongoose";

const CartSchema = new mongoose.Schema({
  userID: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  productID: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  ProductPrice: { type: Number, required: true },
  quantity: { type: Number, required: true }
});

const Cart = mongoose.model('Cart', CartSchema);
export default Cart;
