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

// Google hands back a profile rather than an account. The account is found or
// created here; the route decides whether it may sign in.
export const verifyGoogleProfile = async (req, accessToken, refreshToken, profile, done) => {
    try {
        const email = profile?.emails?.[0]?.value;
        if (!email) {
            return done(new Error('Google did not share an email address'), null);
        }

        let user = await User.findOne({ email });
        if (!user) {
            // A Google account has proved the address, so it starts verified.
            user = new User({
                googleId: profile.id,
                name: profile.displayName,
                email,
                verified: true,
            });
            await user.save();
        } else if (!user.googleId) {
            // An account made with a password and the same address is the same
            // person; remember the Google id so the link survives.
            user.googleId = profile.id;
            if (!user.verified) {
                user.verified = true;
            }
            await user.save();
        }

        return done(null, user);
    } catch (error) {
        return done(error, null);
    }
};

if (clientID && clientSecret && callbackURL) {
  passport.use(new GoogleStrategy({
    clientID,
    clientSecret,
    callbackURL,
    passReqToCallback: true
  }, verifyGoogleProfile));
}

export default passport;
