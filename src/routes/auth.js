const express = require("express");
const router = express.Router();
const { verifyToken } = require("../middleware/auth");
const {
  signup,
  login,
  getCurrentUser,
  adminLogin,
} = require("../controllers/authController");
const { validateEmailDomain } = require("../middleware/auth");
const { checkRole } = require("../middleware/auth");
const passport = require("passport");


router.post("/signup", validateEmailDomain, signup);
router.post("/login", login);

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
    res.redirect(`${process.env.FRONTEND_URL}/login?token=${req.user.token}`);
  }
);

router.get(
  "/me",
  [verifyToken, checkRole(["patient", "admin"])],
  getCurrentUser
);

router.post("/admin/login", adminLogin);

module.exports = router;