import mongoose from 'mongoose';

const discountSchema = new mongoose.Schema({
    percentage: { type: Number, required: true },
    category: { type: String, required: true },
    expiry: { type: Date, required: true }
});

const Discount = mongoose.model('Discount', discountSchema);

export default Discount;
