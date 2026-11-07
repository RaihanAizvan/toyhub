import express from "express";
import { getAbout, getContact, getPrivacy } from "../controllers/userModules/pages.js";

const router = express.Router();

router.get("/about", getAbout);
router.get("/contact", getContact);
router.get("/privacy", getPrivacy);

export default router;
