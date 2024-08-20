import * as userLogin from "../controllers/userController.js"
import express from "express";
const router = express.Router();


 
router.get('/signup', (req, res) => {
    res.render('auth/signup');
});

router.post('/signup', userLogin.postLogin);

export default router;