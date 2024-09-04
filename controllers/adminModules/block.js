import User from '../../models/users.models.js'

const postBlock = async (req, res) => {
  console.log(`entered block`);
    const userId = req.params.id;
    const { action } = req.body; // Expecting { action: 'block' } or { action: 'unblock' }
  
    try {
      // Determine the value to set for `isBlocked` based on the action
      const isBlocked = action === 'block';
  
      // Update the user's block status in the database using updateOne with $set
      const result = await User.updateOne({ _id: userId }, { $set: { isBlocked: isBlocked } });
  
      if (result.nModified === 0) {
        return res.status(404).render({ message: 'User not found or status not modified' });
      }
      //remove user from session
      if (isBlocked && req.session.user && req.session.user._id.toString() === userId) {
        delete req.session.user;
        console.log(` the session is ${req.session}`);
      }
  
      // Respond with the updated block status
      res.status(200).json({ message: 'User status updated successfully', userId: userId, isBlocked: isBlocked });
    } catch (error) {
      console.error('Error updating user status:', error);
      res.status(500).json({ message: 'Server error' });
    }
  }
  export default { postBlock }