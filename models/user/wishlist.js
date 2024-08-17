import mongoose, { Schema } from "mongoose";

const WishlistSchema = new mongoose.Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'userModel' },
    wishlist: [{ type: Schema.Types.ObjectId, ref: 'product' }]
});

const Wishlist = mongoose.model('Wishlist', WishlistSchema);
export default Wishlist;
