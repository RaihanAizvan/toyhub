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
  ratingCount: { type: Number, default: 0 },
  ratings: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Rating' }],
  averageRating: { type: Number, default: 0 }, // Store the calculated average rating
  ratingStats: {
    1: { type: Number, default: 0 }, // Count of 1-star ratings
    2: { type: Number, default: 0 }, // Count of 2-star ratings
    3: { type: Number, default: 0 }, // Count of 3-star ratings
    4: { type: Number, default: 0 }, // Count of 4-star ratings
    5: { type: Number, default: 0 }  // Count of 5-star ratings
  },
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
