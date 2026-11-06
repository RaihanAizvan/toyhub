import User from '../../models/users.models.js'
import { invalidateUserSessions } from '../../utils/session.js'
import { isObjectId } from '../../utils/ownership.js'

const postBlock = async (req, res) => {
  const userId = req.params.id;
  const { action } = req.body; // Expecting { action: 'block' } or { action: 'unblock' }

  if (!isObjectId(userId)) {
    return res.status(404).json({ message: 'User not found' });
  }

  try {
    const isBlocked = action === 'block';
    const result = await User.updateOne({ _id: userId }, { $set: { isBlocked } });

    // Mongoose 8 reports `matchedCount`, not `nModified`. A missing user has
    // nothing matched, which is a 404 rather than a silent success.
    if (result.matchedCount === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (isBlocked) {
      // Invalidate every existing session of the blocked account, in the store
      // the application is actually using.
      const destroyed = await invalidateUserSessions(userId, req.sessionStore);
      console.log(`Invalidated ${destroyed} session(s) for blocked user ${userId}`);
    }

    // Redirect to admin users page
    res.status(200).redirect('/admin/users');
  } catch (error) {
    console.error('Error updating user status:', error);
    res.status(500).json({ message: 'Server error' });
  }
};



  export default { postBlock }