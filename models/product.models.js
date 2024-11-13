import mongoose from "mongoose";

const ProductSchema = new mongoose.Schema({
  name: { type: String, required: true },
  type: { type: String, required: true },
  description1: { type: String, required: true },
  description2: { type: String },
  warnings: { type: String },
  price: { type: Number, required: true },
  color: { type: String },
  weight: { type: Number },
  discount: { type: Number },
  priceAfterDiscount: { type: Number },
  SKU: { type: String },
  category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true }, // Establish reference to Category
  images: [String],
  sold: { type: Number, required: true },
  stock: { type: Number, required: true },
  createdAt: {type: Date , default: Date.now() },
  isBlocked: { type: Boolean, default: false }
});

const Product = mongoose.model('Product', ProductSchema);
export default Product;
