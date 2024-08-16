import express from "express"
import isAdmin from "../middlewares/adminMiddleware.js"
import admin from "../controllers/adminController.js"

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

// Export the router as the default export
export default router
