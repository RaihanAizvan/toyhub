import * as userAuth from "../controllers/userController.js"
import middleware from "../middlewares/userMiddleware.js"
import express from "express";
const router = express.Router();

//auth routes

router.get('/signup', userAuth.getSignup);

router.post('/signup', userAuth.postSignup);

router.get('/otp',userAuth.getOtp);

router.post('/otp',userAuth.postOtp);

router.get('/login', userAuth.getLogin);

router.post('/login', userAuth.postLogin);

router.post('/resent-otp', userAuth.postResentOtp);

router

// hero route

export default router;