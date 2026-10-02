import mongoose from "mongoose";

import {
  RATING_MAX,
  RATING_MIN,
  REVIEW_COMMENT_MAX,
  REVIEW_TITLE_MAX,
} from "../utils/reviews.js";

const RatingSchema = new mongoose.Schema({
    // ... existing fields ...
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    rating: { type: Number, required: true, min: RATING_MIN, max: RATING_MAX },
    date: { type: Date, default: Date.now },
    // Cut rather than refused, so an overlong comment shortens instead of
    // losing the review. The controller does the same before it saves.
    comment: { type: String, maxlength: REVIEW_COMMENT_MAX },
    title: { type: String, maxlength: REVIEW_TITLE_MAX }, // For review title
    isVerifiedPurchase: { type: Boolean, default: false }, // To show if reviewer actually bought the product
    helpfulVotes: { type: Number, default: 0, min: 0 }, // Number of users who found this review helpful
    images: [String], // Allow users to add photos to their reviews
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' } // For review moderation
  });

// One review per person per product. The controller checks this too, but the
// controller can be asked twice at once and only the database can say no.
RatingSchema.index({ productId: 1, userId: 1 }, { unique: true });

const Rating = mongoose.model('Rating', RatingSchema);
export default Rating;