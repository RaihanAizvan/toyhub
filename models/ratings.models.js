import mongoose from "mongoose";

const RatingSchema = new mongoose.Schema({
    // ... existing fields ...
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    date: { type: Date, default: Date.now },
    comment: { type: String },
    title: { type: String }, // For review title
    isVerifiedPurchase: { type: Boolean, default: false }, // To show if reviewer actually bought the product
    helpfulVotes: { type: Number, default: 0 }, // Number of users who found this review helpful
    images: [String], // Allow users to add photos to their reviews
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' } // For review moderation
  });

const Rating = mongoose.model('Rating', RatingSchema);
export default Rating;