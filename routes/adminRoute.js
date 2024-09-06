import express from "express"
import isAdmin from "../middlewares/adminMIddleware.js"
import * as adminController from "../controllers/adminController.js"
import upload from "../utils/multer.js"

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
router.post("/addProduct", upload.array('files', 5),  adminController.postAddProduct)
router.get("/products", adminController.getProductList)
router.get('/editProduct/:id', adminController.getEditProduct);
router.post('/editProduct/:id', upload.single('image'), adminController.postEditProduct);
router.post('/blockProduct/:id', adminController.postBlockProduct);


//!---------------------------------/!/
//todo: define Category routes here/!/
//!-------------------------------/!/

router.get('/category',isAdmin,  adminController.getAddCategory)
router.post('/category', isAdmin, upload.single('image'), adminController.postAddCategory)
router.get('/category/edit/:id', isAdmin, adminController.getEditCategory);
router.post('/category/edit/:id', isAdmin, upload.single('image'), adminController.postEditCategory);
router.post('/category/delete/:id', isAdmin, adminController.postDeleteCategory);

//!-----------------------------/!/
//todo: define user list routes here/!/
//!---------------------------/!/

//router for retrieve all users
router.get("/users", isAdmin, adminController.getUserlist)
//router for block  users
router.post('/blockUser/:id', isAdmin, adminController.postBlock)

export default router


