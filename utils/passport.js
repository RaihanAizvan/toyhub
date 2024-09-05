import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth2';
import dotenv from 'dotenv';
import User from '../models/users.models.js'

dotenv.config();

passport.serializeUser((user, done) => {
    done(null, user._id);  // Store MongoDB's _id in the session
});

passport.deserializeUser(async (id, done) => {
    try {
        const user = await User.findById(id);  // Fetch the user by ID from the database
        done(null, user);
    } catch (error) {
        done(error, null);
    }
});

passport.use(new GoogleStrategy({
    clientID: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    callbackURL: process.env.CALLBACK_URL,
    passReqToCallback: true,
},
async (req, accessToken, refreshToken, profile, done) => {
    try {
        // Find the user by email (Google's profile contains email data)
        let user = await User.findOne({ email: profile.emails[0].value });

        // If the user doesn't exist, create a new user and save it to the database
        if (!user) {
            user = new User({
                googleId: profile.id,
                name: profile.displayName,  // Store the name
                email: profile.emails[0].value,  // Use the email from Google profile
            });
            await user.save();
        }

        // Store the user in the session, including the name
        req.session.user = { id: user._id, name: user.name };

        // For debugging purposes, log the session data
        console.log(`User stored in session: ${JSON.stringify(req.session.user)}`);

        // Call done with the authenticated user
        return done(null, user);

    } catch (error) {
        // Handle errors and pass them to done
        return done(error, null);
    }
}))

export default passport;
