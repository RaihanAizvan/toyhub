import * as userController from "../controllers/userController.js"
import middleware from "../middlewares/userMiddleware.js"
import express from "express";
const router = express.Router();

//auth routes

router.get('/signup', userController.getSignup);

router.post('/signup', userController.postSignup);

router.get('/otp',userController.getOtp);

router.post('/otp',userController.postOtp);

router.get('/login', userController.getLogin);

router.post('/login', userController.postLogin);

router.get('/resend-otp', userController.postResentOtp);

router.get('/logout',userController.getLogout)

router.get('/forgot-password',userController.getForgotPassword)

router.post('/forgot-password',userController.postForgotPassword)

router.get('/reset-password',userController.getResetPassword)

router.post('/reset-password',userController.postResetPassword)

//home
router.get('/category/:id', userController.getProductsByCategory);




export default router;