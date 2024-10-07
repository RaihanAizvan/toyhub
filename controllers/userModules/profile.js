import { title } from "process";
import Users from "../../models/users.models.js"

export async function getProfileEdit( req , res){
    let theName = req.session.user?.name 
    let user = await Users.findOne({name:theName})
    res.status(200).render('user/profile-edit',{
        user, 
        title:'Profile Edit',
        name:user.name
    })
}

export async function postUpdateName(req,res){
    let userId = req.session.user?.id
    const {name} = req.body
    if (!name) {
        return res.status(400).render('user/profile-edit', {
            error: "Name is required",
            user: req.session.user, // Send the current user session back
            classes: 'profile-information', 
            title: 'Profile Edit'
        });
    }

    try {
        // Update user name
        let updatedUser = await Users.findByIdAndUpdate(userId, { name: name }, { new: true });

        // Update session data with the new name
        req.session.user.name = updatedUser.name;

        // Redirect back to the profile or re-render the page with the updated data
        return res.redirect('/account');
    }  catch (error) {
        console.error(error);
        return res.status(500).render('user/profile-edit', {
            error: "An error occurred while updating the name.",
            user: req.session.user, 
            classes: 'profile-information', 
            title: 'Profile Edit'
        });
    }
    
}

export async function postUpdatePhone(req, res) {
    let userId = req.session.user?.id;
    const { phone_number } = req.body;

    if (!phone_number) {
        return res.status(400).render('user/profile-edit', {
            error: "Phone number is required",
            user: req.session.user,
            classes: 'profile-information', 
            title: 'Profile Edit'
        });
    }

    try {
        // Update user phone number
        let updatedUser = await Users.findByIdAndUpdate(userId, { phone_number: phone_number }, { new: true });

        // Update session data with the new phone number
        req.session.user.phone_number = updatedUser.phone_number;

        // Redirect back to the profile or re-render the page with the updated data
        return res.redirect('/account');
    } catch (error) {
        console.error(error);
        return res.status(500).render('user/profile-edit', {
            error: "An error occurred while updating the phone number.",
            user: req.session.user, 
            classes: 'profile-information', 
            title: 'Profile Edit'
        });
    }
}


export default {
    getProfileEdit,
    postUpdateName,
    postUpdatePhone
}
