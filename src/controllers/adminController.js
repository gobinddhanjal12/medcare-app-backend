const pool = require("../config/database");
const bcrypt = require("bcryptjs");
const { cloudinary } = require("../config/cloudinary");
const { sendAppointmentStatusUpdate } = require("../services/emailService");

const createDoctor = async (req, res) => {
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
};

const getPendingAppointments = async (req, res) => {
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
};

const updateAppointmentStatus = async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({
        status: "error",
        message: 'Invalid status. Must be either "approved" or "rejected"',
      });
    }

    await client.query("BEGIN");

    const appointmentResult = await client.query(
      `SELECT 
          a.*,
          u.name as patient_name,
          u.email as patient_email,
          u2.name as doctor_name,
          ts.start_time,
          ts.end_time
        FROM appointments a
        JOIN users u ON a.patient_id = u.id
        JOIN doctors d ON a.doctor_id = d.id
        JOIN users u2 ON d.user_id = u2.id
        JOIN time_slots ts ON a.time_slot_id = ts.id
        WHERE a.id = $1`,
      [id]
    );

    if (appointmentResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        status: "error",
        message: "Appointment not found",
      });
    }

    const appointment = appointmentResult.rows[0];

    if (status === "approved") {
      const availabilityCheck = await client.query(
        `SELECT a.*, u.name as patient_name
           FROM appointments a
           JOIN users u ON a.patient_id = u.id
           WHERE a.doctor_id = $1 
           AND a.appointment_date = $2 
           AND a.time_slot_id = $3 
           AND a.request_status = 'approved'
           AND a.status != 'cancelled'
           AND a.id != $4`,
        [
          appointment.doctor_id,
          appointment.appointment_date,
          appointment.time_slot_id,
          id,
        ]
      );

      if (availabilityCheck.rows.length > 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          status: "error",
          message: `This time slot is already booked by ${availabilityCheck.rows[0].patient_name}`,
        });
      }
    }

    await client.query(
      "UPDATE appointments SET request_status = $1, updated_at = NOW() WHERE id = $2",
      [status, id]
    );

    if (status === "approved") {
      await client.query(
        `UPDATE appointments 
           SET request_status = 'rejected', updated_at = NOW() 
           WHERE time_slot_id = $1 
           AND doctor_id = $2 
           AND appointment_date = $3 
           AND id != $4 
           AND request_status = 'pending'`,
        [
          appointment.time_slot_id,
          appointment.doctor_id,
          appointment.appointment_date,
          id,
        ]
      );

      if (appointment.patient_email) {
        try {
          await sendAppointmentStatusUpdate(appointment, status);
        } catch (emailError) {
          console.error("Error sending status update email:", emailError);
        }
      }
    }

    await client.query("COMMIT");

    res.json({
      status: "success",
      message: `Appointment ${status} successfully`,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error updating appointment status:", error);
    res.status(500).json({
      status: "error",
      message: "Error updating appointment status",
      details: error.message,
    });
  } finally {
    client.release();
  }
};

module.exports = {
  createDoctor,
  getPendingAppointments,
  updateAppointmentStatus,
};
