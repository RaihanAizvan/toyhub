import mongoose from "mongoose";

const AddressSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 60,
  },
  street: {
    type: String,
    required: true,
    trim: true,
    maxlength: 160,
  },
  city: {
    type: String,
    required: true,
    trim: true,
    maxlength: 60,
  },
  state: {
    type: String,
    required: true,
    trim: true,
    maxlength: 60,
  },
  zip: {
    type: String,
    required: true,
    trim: true,
    maxlength: 12,
  },
  // A phone number is a string: a leading zero or a country code must survive
  // the round trip, and it is never used in arithmetic.
  phone: {
    type: String,
    required: true,
    trim: true,
    match: /^[0-9]{7,15}$/,
  },
  isDefault: {
    type: Boolean,
    default: false,
  },
  date: {
    type: Date,
    default: Date.now,
  },
  salesOnThisAddress: {
    type: Number,
    default: 0,
  },
});

const Address = mongoose.model("Address", AddressSchema);
export default Address;
