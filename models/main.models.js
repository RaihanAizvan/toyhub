import mongoose from "mongoose";
import dotenv from "dotenv";
import { requireEnv } from "../utils/config.js";
dotenv.config()


const connectDB = async () => {
    try {
        const mongoUri = requireEnv("MONGO_URI");
        await mongoose.connect(mongoUri);
        console.log('MongoDB connected...');
    } catch (err) {
        console.error(err.message);
        process.exit(1); // Exit process with failure
    }
};

export default connectDB;
