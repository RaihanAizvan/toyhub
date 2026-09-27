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
router.post('/set-default-address/:id', profile.postSetDefaultAddress);
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
// Money is added by paying for a top up, never by asking for a balance.
router.post('/wallet/top-up', profile.postCreateTopUp);
router.post('/wallet/top-up/verify', profile.postVerifyTopUp);
router.get('/wallet/reconciliation', profile.getWalletReconciliation);

router.get('/reviews', profile.getReviews);



export default router