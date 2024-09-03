import express from 'express';
const router = express.Router();
import passport from 'passport';

// Initiating Google authentication
router.get('/google', passport.authenticate('google', {
  scope: ['profile', 'email']
}));

// Handling the callback after Google has authenticated the user
router.get('/google/callback', passport.authenticate('google', { failureRedirect: '/' }), (req, res) => {
    // Successful authentication, redirect to home or dashboard
    res.redirect('/');
  }
);

export default router;
