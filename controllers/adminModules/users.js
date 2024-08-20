import users from '../../models/users.models.js'

// function to create user
async function getUserList(req,res){
    try{
        const usersData = await users.find({})
        res.render('admin/userlist',{users:usersData})
    }catch(error){
        console.error(`OOps Something went wrong:- ${error.message}`)
    }
}



export default {getUserList}