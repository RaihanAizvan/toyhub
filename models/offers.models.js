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
        ref:"product",
    }],

    applicableCategories:[{
        type:mongoose.Schema.Types.ObjectId,
        ref:"category",
    }],

    offerPercentage:{
        type : Number,
        required : true,
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


const Offer = mongoose.model('Offer' , offerSchema)

export default Offer;