import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config()


const connectDB = async () => {
    console.log(process.env.MONGO_URI);
    try {
        if (!process.env.MONGO_URI) {
            throw new Error('there is no MONGO_URI');
        }
        await mongoose.connect(process.env.MONGO_URI);
        console.log('MongoDB connected...');
    } catch (err) {
        console.error(err.message);
        process.exit(1); // Exit process with failure
    }
};

export default connectDB;
