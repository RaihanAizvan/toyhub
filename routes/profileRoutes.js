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
router.post('/orders/invoice/:orderId', profile.postDownloadInvoice);

router.get('/wishlist', profile.getWishlist);
router.post('/wishlist/:id', profile.postWishlist);
router.delete('/wishlist', profile.deleteWishlist);

router.get('/wallet', profile.getWallet);
router.post('/wallet/add-money', profile.postAddMoney);

router.get('/reviews', profile.getReviews);



export default router