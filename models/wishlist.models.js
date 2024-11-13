import mongoose, { Schema } from "mongoose";

const WishlistSchema = new mongoose.Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    wishlist: [{ type: Schema.Types.ObjectId, ref: 'Product' }],
    createdAt: { type: Date, default: Date.now }

});

const Wishlist = mongoose.model('Wishlist', WishlistSchema);
export default Wishlist;
