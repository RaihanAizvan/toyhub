import mongoose from "mongoose";

const CategorySchema = new mongoose.Schema({
  name: { type: String, required: true },
  image: { type: String, required: true },
  items: { type: Number, required: true }
});

const Category = mongoose.model('Category', CategorySchema);
export default Category;
