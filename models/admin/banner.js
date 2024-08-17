import mongoose from "mongoose";

const bannerSchema = new mongoose.Schema({
    title: { type: String },
    imageUrl: [{ type: String }],
    active: { type: Boolean, default: true },
    adminNotes: { type: String }
});

const Banner = mongoose.model('Banner', bannerSchema);

export default Banner;