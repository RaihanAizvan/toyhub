
import mongoose from 'mongoose';

const couponSchema = new mongoose.Schema({
  couponCode: {
    type: String,
    required: true,
    uppercase: true,
    unique: true,
    trim: true
  },
  startDate: {
    type: Date,
    required: true,
    validate: {
      validator: (value) => value >= new Date().setHours(0, 0, 0, 0),
      message: 'Start date cannot be in the past.'
    }
  },
  endDate: {
    type: Date,
    required: true,
    validate: {
      validator: function (value) {
        return value > this.startDate;
      },
      message: 'End date must be after the start date.'
    }
  },
  discount: {
    type: Number,
    required: true,
    min: 0
  },
  discountType: {
    type: String,
    enum: ['percentage', 'fixed'],
    required: true
  },
  usageCount: {
    type: Number,
    default: 0
  }
});

export default mongoose.model('Coupon', couponSchema);
