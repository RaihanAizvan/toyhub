import users from '../../models/users.models.js'
import { parsePagination } from '../../utils/validation.js'

// function to create user list with pagination
async function getUserList(req, res) {
    try {
        const { page, limit, skip } = parsePagination(req.query); // page 1, ten per page, clamped

        const usersData = await users.find({}).skip(skip).limit(limit); // Apply pagination
        const totalUsers = await users.countDocuments({}); // Get total count of users
        const totalPages = Math.ceil(totalUsers / limit); // Calculate total number of pages

        res.render('admin/userlist', { 
            users: usersData, 
            currentPage: page,
            totalPages: totalPages
        }); 
    } catch (error) {
        console.error(`Oops, something went wrong: ${error.message}`);
    }
}

export default { getUserList };