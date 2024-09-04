import express from "express"
import isAdmin from "../middlewares/adminMIddleware.js"
import * as adminController from "../controllers/adminController.js"

const router = express.Router()

//!---------------------------------------/!/
//todo: Define authentication routes here/!/
//!-------------------------------------/!/    

//router for rendering homepage
router.get("/", isAdmin, adminController.getHome)

//router for renderig loginPage
router.get("/login", adminController.getLogin)

// post method for login
router.post("/login", adminController.postLogin)

// post method for logout
router.post("/logout", adminController.postLogout)

//!--------------------------------/!/
//todo: define product routes here/!/
//!------------------------------/!/

//router for renderig addProduct page
router.get("/addProduct", isAdmin, adminController.getAddProduct)

router.post("/addProduct", isAdmin, adminController.postAddProduct)

//!-----------------------------/!/
//todo: define user list routes here/!/
//!---------------------------/!/

//router for retrieve all users
router.get("/users", isAdmin, adminController.getUserlist)

//router for block  users
router.post('/blockUser/:id', isAdmin, adminController.postBlock)

export default router


