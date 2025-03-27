const jwt = require("jsonwebtoken");
const pool = require("../config/database");

const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        status: "error",
        message: "No authorization header provided",
      });
    }

    const token = authHeader.split(" ")[1];

    if (!token) {
      return res.status(401).json({
        status: "error",
        message: "No token provided",
      });
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;

      // Check if user exists
      const result = await pool.query("SELECT * FROM users WHERE id = $1", [
        decoded.id,
      ]);

      if (result.rows.length === 0) {
        return res.status(401).json({
          status: "error",
          message: "User not found",
        });
      }

      next();
    } catch (jwtError) {
      console.error("JWT verification error:", jwtError);
      return res.status(401).json({
        status: "error",
        message: "Invalid token",
      });
    }
  } catch (error) {
    console.error("Auth middleware error:", error);
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
    });
  }
};

const isAdmin = async (req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT * FROM users WHERE id = $1 AND role = $2",
      [req.user.id, "admin"]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({
        status: "error",
        message: "Access denied. Admin privileges required.",
      });
    }

    next();
  } catch (error) {
    console.error("Admin check error:", error);
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
    });
  }
};

const checkRole = (roles) => {
  return async (req, res, next) => {
    try {
      const result = await pool.query("SELECT * FROM users WHERE id = $1", [
        req.user.id,
      ]);

      if (result.rows.length === 0) {
        return res.status(401).json({
          status: "error",
          message: "User not found",
        });
      }

      if (!roles.includes(result.rows[0].role)) {
        return res.status(403).json({
          status: "error",
          message: "Access denied. Insufficient privileges.",
        });
      }

      next();
    } catch (error) {
      console.error("Role check error:", error);
      return res.status(500).json({
        status: "error",
        message: "Internal server error",
      });
    }
  };
};

const validateEmailDomain = (req, res, next) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({
      status: "error",
      message: "Email is required",
    });
  }

  const allowedDomains = ["gmail.com", "tothenew.com"];
  const domain = email.split("@")[1];

  if (!allowedDomains.includes(domain)) {
    return res.status(400).json({
      status: "error",
      message:
        "Registration is only allowed for gmail.com or tothenew.com email domains",
    });
  }

  next();
};

module.exports = {
  verifyToken,
  isAdmin,
  checkRole,
  validateEmailDomain,
};
