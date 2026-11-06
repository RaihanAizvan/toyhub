import express from 'express';
const router = express.Router();
import passport from 'passport';
import User from "../models/users.models.js"
import { regenerateSession } from '../utils/session.js';

// Initiating Google authentication
router.get('/google', passport.authenticate('google', {
  scope: ['profile', 'email']
}));

// Google is not allowed to write the session itself. The session that arrived
// with the request is replaced before anything about the user is stored, the
// same way the password login does it.
export const completeGoogleLogin = async (req, res) => {
  try {
    const user = await User.findById(req.user?.id);
    if (!user) {
      // The account can be removed between Google answering and this callback.
      return res.redirect('/user/login?error=account');
    }

    await regenerateSession(req);

    if (user.isBlocked) {
      return res.redirect('/user/login?blocked=true');
    }

    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      isBlocked: user.isBlocked,
      googleId: user.googleId
    };
    return res.redirect('/');
  } catch (error) {
    console.error('Google login failed:', error);
    return res.redirect('/user/login?error=google');
  }
};

router.get(
  '/google/callback',
  passport.authenticate('google', { failureRedirect: '/', session: false }),
  completeGoogleLogin,
);

export default router;
