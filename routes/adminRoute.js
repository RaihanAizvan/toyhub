import express from "express"
import isAdmin from "../middlewares/adminMIddleware.js"
import * as admin from "../controllers/adminController.js"

const router = express.Router()

//todo: Define authentication routes here
//router for rendering homepage
router.get("/", isAdmin, admin.getHome)

//router for renderig loginPage
router.get("/login", admin.getLogin)

// post method for login
router.post("/login", admin.postLogin)

// post method for logout
router.post("/logout", admin.postLogout)

//todo: define product routes here

//router for renderig addProduct page
router.get("/addProduct", isAdmin, admin.getAddProduct)

// Export the router as the default export
export default router
