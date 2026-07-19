const express = require('express');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { getDB } = require('../config/database');
const { generateToken } = require('../config/passport');

const router = express.Router();

// ==================== GOOGLE STRATEGY ====================
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || '/api/auth/google/callback'
  },
  async function(accessToken, refreshToken, profile, done) {
    try {
      const db = getDB();
      const email = profile.emails?.[0]?.value;
      
      if (!email) {
        return done(new Error('No email from Google'), null);
      }

      let user = await db.collection('customers').findOne({ 
        email: email.toLowerCase() 
      });

      if (!user) {
        const newUser = {
          email: email.toLowerCase(),
          name: profile.displayName || profile.name?.givenName || 'Google User',
          phone: '',
          googleId: profile.id,
          googleData: {
            accessToken: accessToken,
            refreshToken: refreshToken,
            profile: profile._json
          },
          createdAt: new Date(),
          updatedAt: new Date(),
          lastLoginAt: new Date(),
          orderHistory: [],
          favorites: []
        };

        const result = await db.collection('customers').insertOne(newUser);
        user = { ...newUser, _id: result.insertedId };
        console.log(`✅ New Google user registered: ${email}`);
      } else {
        await db.collection('customers').updateOne(
          { _id: user._id },
          { 
            $set: { 
              googleId: profile.id,
              googleData: {
                accessToken: accessToken,
                refreshToken: refreshToken,
                profile: profile._json
              },
              updatedAt: new Date(),
              lastLoginAt: new Date()
            } 
          }
        );
        console.log(`✅ Google user logged in: ${email}`);
      }

      return done(null, user);
    } catch (err) {
      console.error('❌ Google auth error:', err);
      return done(err, null);
    }
  }
));

passport.serializeUser((user, done) => {
  done(null, user._id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const db = getDB();
    const user = await db.collection('customers').findOne({ _id: id });
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

// ==================== GOOGLE AUTH ROUTES ====================

router.get('/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/login' }),
  function(req, res) {
    try {
      const user = req.user;
      const token = generateToken(user._id.toString(), 'customer');
      
      const frontendUrl = process.env.FRONTEND_URL || 'https://teemoreg.github.io/liquorbelle/liquourbelle';
      
      // Redirect to index.html with welcome message
      res.redirect(`${frontendUrl}/index.html?google_auth=success&token=${token}&email=${user.email}&name=${encodeURIComponent(user.name)}&phone=${user.phone || ''}`);
    } catch (err) {
      console.error('❌ Google callback error:', err);
      res.redirect('/login');
    }
  }
);

module.exports = router;