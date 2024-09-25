import Users from "../../models/users.models.js"

export async function getProfileEdit( req , res){
    let user = await Users.findOne(req.session.user)
    res.status(200).render('user/profile-edit',{user})
}

export default {
    getProfileEdit
}