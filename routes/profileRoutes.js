import * as profile from "../controllers/userController.js"
import middleware from "../middlewares/userMiddleware.js"
import express from "express";
const router = express.Router();

router.get('/',middleware.redirectToLoginIfNotAUser, profile.getProfileEdit);
router.post('/update-name',middleware.redirectToLoginIfNotAUser,profile.postUpdateName)
router.post('/update-phone', middleware.redirectToLoginIfNotAUser, profile.postUpdatePhone)
router.get('/address', middleware.redirectToLoginIfNotAUser, profile.getAddress)
router.post('/add-address', middleware.redirectToLoginIfNotAUser, profile.postAddAddress)
router.get('/edit-address/:id', profile.getEditAddress);
router.post('/edit-address/:id', profile.postEditAddress);
router.post('/delete-address/:id', profile.postDeleteAddress);

export default router