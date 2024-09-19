import users from '../../models/users.models.js'

// function to create user list with pagination
async function getUserList(req, res) {
    try {
        const page = parseInt(req.query.page) || 1; // Default to page 1 if not provided
        const limit = parseInt(req.query.limit) || 10; // Limit per page (you can adjust this)
        const skip = (page - 1) * limit; // Calculate how many records to skip

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