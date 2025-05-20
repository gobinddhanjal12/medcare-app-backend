const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../config/database");
const { sendPasswordResetEmail } = require("../services/emailService");

const signup = async (req, res) => {
  try {
    const { email, password, name, role = "patient" } = req.body;

    const existingUser = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({
        status: "error",
        message: "Email already registered. Please login instead.",
      });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const result = await pool.query(
      `INSERT INTO users (email, password, name, role)
             VALUES ($1, $2, $3, $4)
             RETURNING id, email, name, role`,
      [email, hashedPassword, name, role]
    );

    const token = jwt.sign(
      { id: result.rows[0].id, role },
      process.env.JWT_SECRET,
      { expiresIn: "24h" }
    );

    res.status(201).json({
      status: "success",
      data: {
        token,
        user: result.rows[0],
      },
    });
  } catch (error) {
    console.error("Signup error:", error);
    res.status(500).json({
      status: "error",
      message: "Error creating account",
      details: error.message,
    });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await pool.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);

    if (result.rows.length === 0) {
      return res.status(401).json({
        status: "error",
        message: "Invalid credentials",
      });
    }

    const user = result.rows[0];

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({
        status: "error",
        message: "Invalid credentials",
      });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "24h" }
    );

    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({
      status: "success",
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      status: "error",
      message: "Error logging in",
      details: error.message,
    });
  }
};

const getCurrentUser = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
                id,
                name,
                email,
                role,
                created_at,
                updated_at
            FROM users 
            WHERE id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: "error",
        message: "User not found",
      });
    }

    return res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error("Get user details error:", error);
    res.status(500).json({
      status: "error",
      message: "Error fetching user details",
    });
  }
};

const logout = (req, res) => {
  res.clearCookie("token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });

  return res.status(200).json({
    status: "success",
    message: "Logged out successfully",
  });
};

const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    const result = await pool.query("SELECT id FROM users WHERE email = $1", [
      email,
    ]);

    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ status: "error", message: "User not found" });
    }

    const user = result.rows[0];

    const resetToken = jwt.sign({ id: user.id }, process.env.JWT_SECRET, {
      expiresIn: "1h",
    });

    await pool.query("UPDATE users SET reset_token = $1 WHERE id = $2", [
      resetToken,
      user.id,
    ]);

    const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

    await sendPasswordResetEmail(email, resetLink);

    res.json({
      status: "success",
      message: "Password reset email sent successfully",
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    res
      .status(500)
      .json({ status: "error", message: "Error sending password reset email" });
  }
};

const resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res
        .status(400)
        .json({ status: "error", message: "Token and new password required" });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      return res
        .status(400)
        .json({ status: "error", message: "Invalid or expired token" });
    }

    const userResult = await pool.query(
      "SELECT id FROM users WHERE id = $1 AND reset_token = $2",
      [decoded.id, token]
    );

    if (userResult.rows.length === 0) {
      return res
        .status(400)
        .json({ status: "error", message: "Invalid or expired token" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await pool.query(
      "UPDATE users SET password = $1, reset_token = NULL WHERE id = $2",
      [hashedPassword, decoded.id]
    );

    res.json({ status: "success", message: "Password reset successfully" });
  } catch (error) {
    console.error("Reset password error:", error);
    res
      .status(500)
      .json({ status: "error", message: "Error resetting password" });
  }
};

const adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await pool.query(
      "SELECT * FROM users WHERE email = $1 AND role = $2",
      [email, "admin"]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        status: "error",
        message: "Invalid credentials or not an admin account",
      });
    }

    const user = result.rows[0];

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({
        status: "error",
        message: "Invalid credentials",
      });
    }

    const token = jwt.sign(
      { id: user.id, role: "admin" },
      process.env.JWT_SECRET,
      { expiresIn: "24h" }
    );

    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Strict",
      maxAge: 24 * 60 * 60 * 1000,
    });

    res.json({
      status: "success",
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
      },
    });
  } catch (error) {
    console.error("Admin login error:", error);
    res.status(500).json({
      status: "error",
      message: "Error logging in as admin",
      details: error.message,
    });
  }
};

module.exports = {
  signup,
  login,
  logout,
  getCurrentUser,
  forgotPassword,
  resetPassword,
  adminLogin,
};
