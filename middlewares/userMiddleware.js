import User from '../models/users.models.js';
function isUser(req, res, next) {
  if (req.session.user) {
    next()
  } else {
    res.status(403).send("Access denied. not authenticated.")
  }
}
const checkBlockStatus = async (req, res, next) => {
  try {
    // Check if the user is logged in (has an active session)
    if (req.session.user) {
      const userId = req.session.user._id;

      // Fetch the user from the database
      const user = await User.findById(userId);

      // If user is blocked, destroy the session and redirect to login
      if (user && user.isBlocked) {
        // Destroy the session
        delete req.session.user;
        req.session.destroy((err) => {
          if (err) {
            console.error('Error destroying session:', err);
          }
          // Redirect to login with a message
          return res.redirect('/login?message=Your account has been blocked. Please contact support.');
        });
      } else {
        // If user is not blocked, proceed to the next middleware or route
        next();
      }
    } else {
      // If there's no session, just proceed (user is not logged in)
      next();
    }
  } catch (error) {
    console.error('Error checking block status:', error);
    res.status(500).json({ message: 'Server error' });
  }
};


export default {
  isUser,
  checkBlockStatus
}
