import mongoose from "mongoose";

const CategorySchema = new mongoose.Schema({
  name: { type: String, required: true },
  image: { type: String },
  isActive: { type: Boolean, default:true }
});

const Category = mongoose.model('Category', CategorySchema);
export default Category;
