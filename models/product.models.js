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
  offerDiscount: { type: Number, default: 0 },
  availableOffers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Offer' }],
  priceAfterDiscount: { type: Number },
  SKU: { type: String },
  category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true }, // Establish reference to Category
  images: [String],
  sold: { type: Number, required: true },
  stock: { type: Number, required: true },
  createdAt: {type: Date , default: Date.now() },
  isBlocked: { type: Boolean, default: false }
});


ProductSchema.methods.calculateOfferDiscount = function () {
  let totalDiscount = 0;

  // Iterate through availableOffers and calculate the discount
  this.availableOffers.forEach(offer => {
      if (offer.type === 'percentage') {
          totalDiscount += (this.price * offer.value) / 100;
      } else if (offer.type === 'fixed') {
          totalDiscount += offer.value;
      }
  });

  // Cap total discount if needed (e.g., not exceeding the product price)
  this.offerDiscount = Math.min(totalDiscount, this.price);

  return this.offerDiscount; // return it for immediate use if needed
};

const Product = mongoose.model('Product', ProductSchema);
export default Product;
