import Users from "../../models/users.models.js"
import Address from "../../models/address.models.js";

const getAddress = async (req, res) => {
    try {
      // Find the user by their session user ID and populate their addresses
      const user = await Users.findOne({ name: req.session.user?.name }).populate('addresses');
      
      // Check if user exists and has addresses
      if (!user) {
        return res.status(404).send('User not found');
      }
  
      // Render the profile address page and pass the user and addresses data
      res.render('user/profile-address', {
        title: 'Manage Addresses',
        user: user,  // Pass the user object (with addresses)
        name: user.name,
        addresses: user.addresses  // Pass the user's addresses
      });
    } catch (err) {
      console.error(err);
      res.status(500).send('Server error');
    }
  };

  const postAddAddress = async (req, res) => {
    try {
        const { name, street, city, state, zip, phone } = req.body;
        const userId = req.session.user?.id;  // Assuming you store the user ID in the session
        
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
    
        // Save the new address to the Address schema
        await newAddress.save();
        console.log('Address added to Address collection');
    
        // Find the user by their ID and add the address to their addresses array
        await Users.findByIdAndUpdate(userId, {
            $push: { addresses: newAddress._id }
        });
        console.log('Address reference added to User schema');
    
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



export default {
    getAddress,
    postAddAddress,
    getEditAddress,
    postEditAddress,
    postDeleteAddress
}