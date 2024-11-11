import Users from "../../models/users.models.js"
import Address from "../../models/address.models.js";
import bcrypt from "bcrypt"

const getAddress = async (req, res) => {
    try {
      // Ensure the user is authenticated
      const userId = req.session.user?.id;  // It's better to use the ID rather than the name for user lookups
      if (!userId) {
        return res.status(401).send('User not authenticated'); // Check if user is authenticated
      }
  
      // Find the user by their session user ID and populate their addresses
      const user = await Users.findById(userId).populate('addresses');  // Using ID is more reliable than name
  
      // Check if user exists and has addresses
      if (!user) {
        return res.status(404).send('User not found');
      }
  
      // Render the profile address page and pass the user and addresses data
      res.render('user/profile-address', {
        title: 'Manage Addresses',
        user: user,  // Pass the user object (with addresses)
        name: user.name,
        addresses: user.addresses || []  // Ensure addresses is an array
      });
    } catch (err) {
      console.error(err);
      res.status(500).send('Server error');
    }
  };
  

  const postAddAddress = async (req, res) => {
    try {
      const { name, street, city, state, zip, phone } = req.body;
      const userId = req.session.user?.id;  // Assuming the user ID is stored in the session
  
      // Create a new address
      const newAddress = new Address({
        user: userId,
        name,
        street,
        city,
        state,
        zip,
        phone
      });
  
      // Save the new address
      await newAddress.save();
      console.log('Address added to Address collection');
  
      // Add the new address reference to the user schema
      await Users.findByIdAndUpdate(userId, {
        $push: { addresses: newAddress._id }
      });
      console.log('Address reference added to User schema');
  
      // Set the success toastr message
      req.session.toastrMessage = 'Address added successfully';
  
      // Redirect to the address management page
      res.redirect('/account/address');
    } catch (err) {
      console.error(err);
      res.status(500).send('Server error');
    }
  };

// GET: Show the edit address form
const getEditAddress = async (req, res) => {
    try {
        const addressId = req.params.id;
        
        // Find the address by its ID
        const address = await Address.findById(addressId);

        // If address not found, send a 404 error
        if (!address) {
            return res.status(404).send('Address not found');
        }

        // Render the edit address page with the address details
        res.render('user/profile-editAddress', {
            title: 'Edit Address',
            address: address
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
};

// POST: Update address details
const postEditAddress = async (req, res) => {
    try {
        const addressId = req.params.id;
        const { name, street, city, state, zip, phone } = req.body;

        // Update the address by ID
        await Address.findByIdAndUpdate(addressId, {
            name,
            street,
            city,
            state,
            zip,
            phone
        });

        console.log(`Address with ID ${addressId} updated`);
        
        // Redirect back to the address management page
        res.redirect('/account/address');
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
};

// POST: Delete address
const postDeleteAddress = async (req, res) => {
    try {
        const addressId = req.params.id;
        const userId = req.session.user?.id; // Assuming session has user ID
        
        // Remove the address from the Address collection
        await Address.findByIdAndDelete(addressId);
        console.log(`Address with ID ${addressId} deleted`);
        
        // Update the user to remove the address reference
        await Users.findByIdAndUpdate(userId, {
            $pull: { addresses: addressId }
        });
        console.log('Address reference removed from User');

        // Redirect to address management page
        res.redirect('/account/address');
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
};


const getChangePassword = (req, res) => {
    if (req.session.user.googleId){
        console.log(1);
            return res.render('user/profile-changePasssword', {
            user: req.session.user,
            error: 'Google users cannot change their password here. Please use Google account settings.',
            title: "Change Password",
            name: req.session.user?.name
        });
    }
    res.render('user/profile-changePasssword', {
        user: req.session.user, 
        error: null,
        title:"Change Password",
        name:req.session.user?.name,
        googleId: req.session.user?.googleId
    });
};

// Handle the password change logic
const postChangePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword, confirmPassword } = req.body;
        const userId = req.session.user.id; // Get the user ID from the logged-in session
        // Find the user by ID
        const user = await Users.findById(userId);

        // Check if current password matches
        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
            return res.render('user/profile-changePasssword', { 
                user: req.session.user, 
                error: 'Current password is incorrect',
                title:"Change Password",
                name:req.session.user?.name
            });
        }

        // Check if new password and confirm password match
        if (newPassword !== confirmPassword) {
            return res.render('user/profile-changePasssword', { 
                user: req.user, 
                error: 'Passwords do not match' 
            });
        }

        // Hash the new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update the user's password in the database
        user.password = hashedPassword;
        await user.save();

        res.redirect('/account/change-password'); // Redirect to profile after successful change
    } catch (error) {
        console.error(error);
        res.render('user/profile-changePasssword', { 
            user: req.session.user, 
            error: 'An error occurred. Please try again later.',
            title:"Change Password"
        });
    }
};


export default {
    getAddress,
    postAddAddress,
    getEditAddress,
    postEditAddress,
    postDeleteAddress,
    getChangePassword,
    postChangePassword
}