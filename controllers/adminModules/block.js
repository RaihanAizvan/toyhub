import User from '../../models/users.models.js'

const postBlock = async (req, res) => {
  const userId = req.params.id;
  const { action } = req.body; // Expecting { action: 'block' } or { action: 'unblock' }

  try {
    var isBlocked = action === 'block';
    const result = await User.updateOne({ _id: userId }, { $set: { isBlocked: isBlocked } });

    if (result.nModified === 0) {
      return res.status(404).json({ message: 'User not found or status not modified' });
    }

    // Add detailed logs to capture the entire session state
    console.log('Current session before checking user:', req.session);
    console.log('isBlocked value:', isBlocked); 

    // Check if there's a session and the session user ID matches the ID being blocked
    if (isBlocked && req.session.user && req.session.user.id) {
      console.log(1);
      // Use the toString method safely
      if (req.session.user.id.toString() === userId) {
        console.log('Destroying session for blocked user:', userId);
        
        // Set a toast message
        req.session.toast = {
          message: `User ${isBlocked ? 'blocked' : 'unblocked'} successfully!`,
          type: 'success',
        };
        req.session.flashMessage = {
          message: 'Your account has been blocked. Please contact support.',
          type: 'error'
        };
        req.session.destroy((err) => {
          if (err) {
            console.error('Error destroying session:', err);
            // Optionally, send an error response to the client if needed
          } else {
            console.log('User session destroyed successfully.');
          }
        });
      }
    }

   

    // Redirect to admin users page
    res.status(200).redirect('/admin/users');
  } catch (error) {
    console.error('Error updating user status:', error);
    res.status(500).json({ message: 'Server error' });
  }
};



  export default { postBlock }