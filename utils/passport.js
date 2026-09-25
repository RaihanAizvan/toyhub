import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth2';
import { readEnv } from './config.js';
import User from '../models/users.models.js'

passport.serializeUser((user, done) => {
    done(null, user.id);  // Store MongoDB's _id in the session
});

passport.deserializeUser(async (id, done) => {
    try {
        const user = await User.findById(id);  // Fetch the user by ID from the database
        done(null, user);
    } catch (error) {
        done(error, null);
    }
});

const clientID = readEnv('CLIENT_ID');
const clientSecret = readEnv('CLIENT_SECRET');
const callbackURL = readEnv('CALLBACK_URL');

if (clientID && clientSecret && callbackURL) {
  passport.use(new GoogleStrategy({
    clientID,
    clientSecret,
    callbackURL,
    passReqToCallback: true
  },
async (req, accessToken, refreshToken, profile, done) => {
    try {
        let user = await User.findOne({ email: profile.emails[0].value });
        if (!user) {
            user = new User({
                googleId: profile.id,
                name: profile.displayName,
                email: profile.emails[0].value,
            });
            await user.save();
        }
        // Passport will serialize the user ID and handle session storage
        return done(null, user);
    } catch (error) {
        return done(error, null);
    }
}));
}

export default passport;
