import users from "../../models/users.models.js"

async function postSignup(req, res) {
    try {
        const { name, email, password } = req.body;

        // Check if the email already exists
        const existingUser = await users.findOne({ email });

        if (existingUser) {
            return res.status(400).render('register', { 
                message: 'Email already exists', 
                name, 
                email 
            });
        }

        // Create a new user if the email doesn't exist
        const newUser = new users({
            name,
            email,
            password
        });

        await newUser.save();

        res.status(200).send('Successfully created');
        console.log(`User created successfully and the name is ${newUser.name}`);
    } catch (error) {
        console.log(error);
        res.status(500).render('signup', { message:"an error occured" });
    }
}

export default {
    postSignup,
}