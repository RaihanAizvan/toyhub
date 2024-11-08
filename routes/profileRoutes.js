import * as profile from "../controllers/userController.js"
import middleware from "../middlewares/userMiddleware.js"
import express from "express";
const router = express.Router();

router.use(middleware.redirectToLoginIfNotAUser)

router.get('/', profile.getProfileEdit);
router.post('/update-name', profile.postUpdateName)
router.post('/update-phone', profile.postUpdatePhone)
router.get('/address', profile.getAddress)
router.post('/add-address', profile.postAddAddress)
router.get('/edit-address/:id', profile.getEditAddress);
router.post('/edit-address/:id', profile.postEditAddress);
router.post('/delete-address/:id', profile.postDeleteAddress);
router.get('/change-password', profile.getChangePassword);
router.post('/change-password', profile.postChangePassword);

router.get('/orders', profile.getOrderHistory)
router.get('/orders/:id', profile.getOrderDetail);
router.get('/orders/:id/cancel-reason', profile.getCancelReason);
router.post('/orders/:id/cancel-reason', profile.postOrderCancel);
router.post('/orders/:orderId/cancel-item', profile.postItemCancel);


export default router