import mongoose from "mongoose";

//* **************************************************************************************************************************
/**
 * @function offerSchema
 * @description Defines the schema for offers.
*/
//* **************************************************************************************************************************

const offerSchema = new mongoose.Schema({
    name:{
        required:true,
        type:String,
    },

    description:{
        type:String,
    },

    offerType:{
        type:String,
        enum:["product","category","all"],
        required:true,
    },

    applicableProducts:[{
        type:mongoose.Schema.Types.ObjectId,
        ref:"Product",
    }],

    applicableCategories:[{
        type:mongoose.Schema.Types.ObjectId,
        ref:"Category",
    }],

    // A discount is a discount: a shop cannot take more than the whole price
    // off, and the field is checked in the model so a bad value cannot be
    // written by any route.
    offerPercentage:{
        type : Number,
        required : true,
        min: 0,
        max: 100,
    },

    startDate:{
        type : Date,
        required : true,

    },
    endDate:{
        type : Date,
        required : true,
    },

    isBlocked:{
        type:Boolean,
        default:false,
    }
})

// An offer that ends before it starts is not an offer, and a live one is the
// only kind that can be stored as new.
offerSchema.pre("validate", function (next) {
    if (this.startDate && this.endDate && new Date(this.endDate) <= new Date(this.startDate)) {
        this.invalidate("endDate", "An offer has to end after it starts.");
    }
    next();
});


const Offer = mongoose.model('Offer' , offerSchema)

export default Offer;