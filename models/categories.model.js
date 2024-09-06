import mongoose from "mongoose";

const CategorySchema = new mongoose.Schema({
  name: { type: String, required: true },
  image: { type: String },
  products: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }]  // Store related products
},{timestamps:true});

const Category = mongoose.model('Category', CategorySchema);
export default Category;
