import express from 'express';
const router = express.Router();
import passport from 'passport';
import middleware from "../middlewares/userMiddleware.js"
import User from "../models/users.models.js"


// Initiating Google authentication
router.get('/google', passport.authenticate('google', {
  scope: ['profile', 'email']
}));

// Handling the callback after Google has authenticated the user
router.get('/google/callback', passport.authenticate('google', { failureRedirect: '/' }), async (req, res) => {
    // Successful authentication, store details in session and redirect to home or dashboard
    const user = await User.findById(req.user.id);

    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      isBlocked: user.isBlocked,
      googleId: user.googleId
    };
    if(user.isBlocked) {
      return res.redirect('/user/login?blocked=true');
    }
    res.redirect('/');
  }
);

export default router;
