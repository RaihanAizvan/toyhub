import User from '../../models/users.models.js'
import { invalidateUserSessions } from '../../utils/session.js'

const postBlock = async (req, res) => {
  const userId = req.params.id;
  const { action } = req.body; // Expecting { action: 'block' } or { action: 'unblock' }

  try {
    var isBlocked = action === 'block';
    const result = await User.updateOne({ _id: userId }, { $set: { isBlocked: isBlocked } });

    if (result.nModified === 0) {
      return res.status(404).json({ message: 'User not found or status not modified' });
    }

    if (isBlocked) {
      // Invalidate every existing session of the blocked account
      const destroyed = await invalidateUserSessions(userId);
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