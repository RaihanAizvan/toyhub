import * as profile from "../controllers/userController.js"
import middleware from "../middlewares/userMiddleware.js"
import express from "express";
const router = express.Router();

router.get('/',middleware.redirectToLoginIfNotAUser, profile.getProfileEdit);
router.post('/update-name',profile.postUpdateName)
router.post('/update-phone',profile.postUpdatePhone)

export default router