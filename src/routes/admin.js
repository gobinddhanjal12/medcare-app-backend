const express = require("express");
const router = express.Router();
const { verifyToken, isAdmin } = require("../middleware/auth");
const pool = require("../config/database");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const { cloudinary } = require("../config/cloudinary");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Not an image! Please upload an image."), false);
    }
  },
});

router.use(verifyToken, isAdmin);

router.post(
  "/doctors",
  [verifyToken, isAdmin],
  upload.single("photo"),
  async (req, res) => {
    const client = await pool.connect();
    try {
      const {
        name,
        email,
        password,
        specialty,
        experience,
        education,
        bio,
        consultation_fee,
        location,
        languages,
        gender,
      } = req.body;

      if (!name || !email || !specialty || !consultation_fee || !gender) {
        return res.status(400).json({
          status: "error",
          message:
            "Please provide all required fields: name, email, specialty, consultation_fee, and gender",
        });
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          status: "error",
          message: "Invalid email format",
        });
      }

      if (!["male", "female", "other"].includes(gender.toLowerCase())) {
        return res.status(400).json({
          status: "error",
          message: "Gender must be male, female, or other",
        });
      }

      await client.query("BEGIN");

      const existingUser = await client.query(
        "SELECT id FROM users WHERE email = $1",
        [email]
      );

      if (existingUser.rows.length > 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          status: "error",
          message: "Email already exists",
        });
      }

      let userResult;
      if (password) {
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        userResult = await client.query(
          `INSERT INTO users (name, email, password, role) 
               VALUES ($1, $2, $3, 'doctor') 
               RETURNING id`,
          [name, email, hashedPassword]
        );
      } else {
        userResult = await client.query(
          `INSERT INTO users (name, email, role) 
               VALUES ($1, $2, 'doctor') 
               RETURNING id`,
          [name, email]
        );
      }

      const userId = userResult.rows[0].id;

      let photo_path = process.env.DEFAULT_DOCTOR_IMAGE;
      if (req.file) {
        try {
          console.log("File received:", {
            filename: req.file.originalname,
            mimetype: req.file.mimetype,
            size: req.file.size,
          });

          const b64 = Buffer.from(req.file.buffer).toString("base64");
          const dataURI = `data:${req.file.mimetype};base64,${b64}`;

          console.log("Uploading to Cloudinary...");

          const uploadResponse = await cloudinary.uploader.upload(dataURI, {
            folder: "medcare/doctors",
            transformation: [
              { width: 500, height: 500, crop: "fill" },
              { quality: "auto" },
            ],
          });

          console.log("Cloudinary upload response:", uploadResponse);
          photo_path = uploadResponse.secure_url;
        } catch (uploadError) {
          console.error("Error uploading image:", uploadError);
          console.error("Error details:", {
            message: uploadError.message,
            stack: uploadError.stack,
          });
        }
      } else {
        console.log("No file received in request");
      }

      let parsedLanguages = null;
      if (languages) {
        try {
          parsedLanguages = JSON.parse(languages);
        } catch (error) {
          parsedLanguages = null;
        }
      }

      await client.query(
        `INSERT INTO doctors (
              user_id, specialty, experience, education, bio, 
              consultation_fee, location, languages, photo_path, gender
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          userId,
          specialty,
          experience || null,
          education || null,
          bio || null,
          consultation_fee,
          location || null,
          parsedLanguages,
          photo_path,
          gender,
        ]
      );

      await client.query("COMMIT");

      res.status(201).json({
        status: "success",
        message: "Doctor created successfully",
        data: {
          photo_url: photo_path,
        },
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Error creating doctor:", error);
      res.status(500).json({
        status: "error",
        message: "Error creating doctor",
      });
    } finally {
      client.release();
    }
  }
);

router.get("/appointments/pending", async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    const query = `
      SELECT 
        a.*,
        p.name as patient_name,
        p.email as patient_email,
        d.specialty,
        u.name as doctor_name,
        u.email as doctor_email,
        ts.start_time,
        ts.end_time
      FROM appointments a
      JOIN users p ON a.patient_id = p.id
      JOIN doctors d ON a.doctor_id = d.id
      JOIN users u ON d.user_id = u.id
      JOIN time_slots ts ON a.time_slot_id = ts.id
      WHERE a.request_status = 'pending'
      ORDER BY a.appointment_date ASC, ts.start_time ASC
      LIMIT $1 OFFSET $2
    `;

    const countQuery = `
      SELECT COUNT(*) 
      FROM appointments 
      WHERE request_status = 'pending'
    `;

    const [appointments, totalCount] = await Promise.all([
      pool.query(query, [limit, offset]),
      pool.query(countQuery),
    ]);

    const total = parseInt(totalCount.rows[0].count);
    const pages = Math.ceil(total / limit);

    res.json({
      status: "success",
      data: appointments.rows,
      pagination: {
        total,
        page: parseInt(page),
        pages,
        limit: parseInt(limit),
      },
    });
  } catch (error) {
    console.error("Get pending appointments error:", error);
    res.status(500).json({
      status: "error",
      message: "Error fetching pending appointments",
      details: error.message,
    });
  }
});

router.patch("/appointments/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({
        status: "error",
        message: 'Invalid status. Must be either "approved" or "rejected"',
      });
    }

    const result = await pool.query(
      "UPDATE appointments SET request_status = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
      [status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: "error",
        message: "Appointment not found",
      });
    }

    if (status === "approved") {
      await pool.query(
        `UPDATE appointments 
         SET request_status = 'rejected', updated_at = NOW() 
         WHERE time_slot_id = $1 
         AND doctor_id = $2 
         AND appointment_date = $3 
         AND id != $4 
         AND request_status = 'pending'`,
        [
          result.rows[0].time_slot_id,
          result.rows[0].doctor_id,
          result.rows[0].appointment_date,
          id,
        ]
      );
    }

    res.json({
      status: "success",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Update appointment status error:", error);
    res.status(500).json({
      status: "error",
      message: "Error updating appointment status",
      details: error.message,
    });
  }
});

router.get("/doctors", async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    const query = `
      SELECT 
        d.*,
        u.name,
        u.email,
        u.is_active,
        COALESCE(AVG(r.rating), 0)::TEXT as average_rating,
        COUNT(r.id) as total_reviews
      FROM doctors d
      JOIN users u ON d.user_id = u.id
      LEFT JOIN reviews r ON d.id = r.doctor_id
      GROUP BY d.id, u.id
      ORDER BY u.is_active DESC, d.experience DESC
      LIMIT $1 OFFSET $2
    `;

    const countQuery = "SELECT COUNT(*) FROM doctors";

    const [doctors, totalCount] = await Promise.all([
      pool.query(query, [limit, offset]),
      pool.query(countQuery),
    ]);

    const total = parseInt(totalCount.rows[0].count);
    const pages = Math.ceil(total / limit);

    res.json({
      status: "success",
      data: doctors.rows,
      pagination: {
        total,
        page: parseInt(page),
        pages,
        limit: parseInt(limit),
      },
    });
  } catch (error) {
    console.error("Get all doctors error:", error);
    res.status(500).json({
      status: "error",
      message: "Error fetching doctors",
      details: error.message,
    });
  }
});

router.patch("/doctors/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;

    if (typeof is_active !== "boolean") {
      return res.status(400).json({
        status: "error",
        message: "is_active must be a boolean value",
      });
    }

    const result = await pool.query(
      `UPDATE users u
       SET is_active = $1, updated_at = NOW()
       FROM doctors d
       WHERE d.user_id = u.id AND d.id = $2
       RETURNING u.*, d.*`,
      [is_active, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: "error",
        message: "Doctor not found",
      });
    }

    res.json({
      status: "success",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Update doctor status error:", error);
    res.status(500).json({
      status: "error",
      message: "Error updating doctor status",
      details: error.message,
    });
  }
});

module.exports = router;
