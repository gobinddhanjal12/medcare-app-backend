const express = require("express");
const router = express.Router();
const { verifyToken } = require("../middleware/auth");
const {
  signup,
  login,
  logout,
  getCurrentUser,
  adminLogin,
  forgotPassword,
  resetPassword,
} = require("../controllers/authController");
const { validateEmailDomain } = require("../middleware/auth");
const { checkRole } = require("../middleware/auth");
const passport = require("passport");

router.post("/signup", validateEmailDomain, signup);

router.post("/login", login);

router.post("/logout", logout);

router.get(
  "/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
    session: false,
  })
);

router.get(
  "/google/callback",
  passport.authenticate("google", { session: false }),
  (req, res) => {
    if (!req.user || !req.user.token) {
      return res.redirect(
        `${process.env.FRONTEND_URL}/login?error=Authentication Failed`
      );
    }

    res.cookie("token", req.user.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "None",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.redirect(`${process.env.FRONTEND_URL}/`);
  }
);

router.get(
  "/me",
  [verifyToken, checkRole(["patient", "admin"])],
  getCurrentUser
);

router.post("/forgot-password", forgotPassword);

router.post("/reset-password", resetPassword);

router.post("/admin/login", adminLogin);

module.exports = router;
