require("dotenv").config();
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const pool = require("../config/database");
const jwt = require("jsonwebtoken");

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: `${process.env.BACKEND_URL}/api/v1/auth/google/callback`,
      passReqToCallback: true,
    },
    async (req, accessToken, refreshToken, profile, done) => {
      try {
        const { id, displayName, emails } = profile;
        const email = emails[0].value;

        const googleEmail = email || `google|${id}@noemail.com`;

        const existingUser = await pool.query(
          "SELECT * FROM users WHERE email = $1",
          [googleEmail]
        );

        let user;
        if (existingUser.rows.length > 0) {
          user = existingUser.rows[0];
        } else {
          const newUser = await pool.query(
            `INSERT INTO users (email, name, password, role)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [googleEmail, displayName, null, "patient"]
          );
          user = newUser.rows[0];
        }

        const token = jwt.sign(
          { id: user.id, role: user.role },
          process.env.JWT_SECRET,
          { expiresIn: "24h" }
        );

        return done(null, { token, user });
      } catch (error) {
        return done(error, null);
      }
    }
  )
);

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

module.exports = passport;
