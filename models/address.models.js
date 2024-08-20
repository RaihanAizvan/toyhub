import mongoose, { Schema } from "mongoose";

const AddressSchema = new mongoose.Schema({
  address: { type: String, required: true },
  apartment: { type: String },
  city: { type: String, required: true },
  state: { type: String, required: true },
  pincode: { type: String, required: true },
  date: { type: Date, default: Date.now }
});
const Address = mongoose.model('Address', AddressSchema);
export default Address;
