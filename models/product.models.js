import mongoose, { Schema } from "mongoose";
const ProductSchema = new mongoose.Schema({
  name: { type: String, required: true },
  type: { type: String, required: true },
  decp1: { type: String, required: true },
  desp2: { type: String },
  warnings: { type: String },
  price: { type: Number, required: true },
  color: { type: String },
  weight: { type: Number },
  discount: { type: Number },
  SKU: { type: String },
  category: { type: String, required: true },
  image: [String],
  sold: { type: Number, required: true },
  stock: { type: Number, required: true }
});

const Product = mongoose.model('Product', ProductSchema);
export default Product;
