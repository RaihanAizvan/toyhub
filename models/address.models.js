import mongoose, { Schema } from "mongoose";

const AddressSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  name: {
    type: String,
    required: true
  },
  street: {
    type: String,
    required: true
  },
  city: {
    type: String,
    required: true
  },
  state: {
    type: String,
    required: true
  },
  zip: {
    type: String,
    required: true
  },
  phone: {
    type: Number,
    required: true
  },
  date: {
    type: Date,
    default: Date.now
  },
  salesOnThisAddress: {
    type:Number,
    default:0
  }
});
const Address = mongoose.model('Address', AddressSchema);
export default Address;
