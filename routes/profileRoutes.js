import * as profile from "../controllers/userController.js"
import middleware from "../middlewares/userMiddleware.js"
import express from "express";
const router = express.Router();

router.get('/', profile.getProfileEdit);


export default router