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

// Requesting another code changes the account's pending code, so it is a POST.
// As a GET it was reachable from any page, which is how the code somebody was
// typing got thrown away.
router.post('/resend-otp', userController.postResentOtp);

// Logging out is a change to the account, so it is a POST carrying the CSRF
// token. It used to be a GET, which any page on the internet could ask a
// browser to fetch and quietly sign the person out.
router.post('/logout',userController.postLogout)

router.get('/forgot-password',userController.getForgotPassword)

router.post('/forgot-password',userController.postForgotPassword)

router.get('/reset-password',userController.getResetPassword)

router.post('/reset-password',userController.postResetPassword)

//home
router.get('/category/:id', userController.getProductsByCategory);




export default router;