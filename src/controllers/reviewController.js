const pool = require("../config/database");

const getAllReviews = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    const countResult = await pool.query("SELECT COUNT(*) FROM reviews");
    const total = parseInt(countResult.rows[0].count);
    const pages = Math.ceil(total / limit);

    const result = await pool.query(
      `SELECT 
                r.*,
                u.name as patient_name,
                d.specialty,
                doc.name as doctor_name,
                a.appointment_date,
                ts.start_time,
                ts.end_time
            FROM reviews r
            JOIN users u ON r.patient_id = u.id
            JOIN appointments a ON r.appointment_id = a.id
            JOIN doctors d ON r.doctor_id = d.id
            JOIN users doc ON d.user_id = doc.id
            JOIN time_slots ts ON a.time_slot_id = ts.id
            ORDER BY r.rating DESC, r.created_at DESC
            LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    res.json({
      status: "success",
      data: result.rows,
      pagination: {
        total,
        page: parseInt(page),
        pages,
        limit: parseInt(limit),
      },
    });
  } catch (error) {
    console.error("Get all reviews error:", error);
    res.status(500).json({
      status: "error",
      message: "Error fetching reviews",
    });
  }
};

const getAllReviewOfSingleDoctor = async (req, res) => {
  try {
    const { doctorId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const reviewsResult = await pool.query(
      `SELECT r.*, u.name as patient_name, a.appointment_date, ts.start_time, ts.end_time
               FROM reviews r
               JOIN users u ON r.patient_id = u.id
               JOIN appointments a ON r.appointment_id = a.id
               JOIN time_slots ts ON a.time_slot_id = ts.id
               WHERE r.doctor_id = $1
               ORDER BY r.created_at DESC
               LIMIT $2 OFFSET $3`,
      [doctorId, limit, offset]
    );

    const totalResult = await pool.query(
      "SELECT COUNT(*) as count FROM reviews WHERE doctor_id = $1",
      [doctorId]
    );

    res.json({
      status: "success",
      data: reviewsResult.rows,
      pagination: {
        total: parseInt(totalResult.rows[0].count),
        page,
        totalPages: Math.ceil(parseInt(totalResult.rows[0].count) / limit),
        limit,
      },
    });
  } catch (error) {
    console.error("Error fetching doctor reviews:", error);
    res.status(500).json({
      status: "error",
      message: "Error fetching reviews",
    });
  }
};

const createReview = async (req, res) => {
  const client = await pool.connect();
  try {
    const { appointment_id, rating, comment } = req.body;

    // Validate input
    if (!appointment_id || !rating || rating < 1 || rating > 5) {
      return res.status(400).json({
        status: "error",
        message: "Invalid input. Rating must be between 1 and 5.",
      });
    }

    await client.query("BEGIN");

    // Check if appointment exists and belongs to the patient
    const appointmentResult = await client.query(
      `SELECT a.*, d.id as doctor_id 
             FROM appointments a
             JOIN doctors d ON a.doctor_id = d.id
             WHERE a.id = $1 AND a.patient_id = $2 AND a.status = 'approved' AND NOT a.is_reviewed`,
      [appointment_id, req.user.id]
    );

    if (appointmentResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        status: "error",
        message: "Appointment not found, not approved, or already reviewed",
      });
    }

    const appointment = appointmentResult.rows[0];

    // Check if review already exists
    const existingReview = await client.query(
      "SELECT * FROM reviews WHERE appointment_id = $1",
      [appointment_id]
    );

    if (existingReview.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        status: "error",
        message: "Review already exists for this appointment",
      });
    }

    // Create the review
    const result = await client.query(
      `INSERT INTO reviews (doctor_id, patient_id, appointment_id, rating, comment)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
      [appointment.doctor_id, req.user.id, appointment_id, rating, comment]
    );

    // Update doctor's average rating
    await client.query(
      `UPDATE doctors 
             SET average_rating = (
               SELECT ROUND(AVG(rating)::numeric, 2)
               FROM reviews
               WHERE doctor_id = $1
             )
             WHERE id = $1`,
      [appointment.doctor_id]
    );

    // Mark appointment as reviewed
    await client.query(
      "UPDATE appointments SET is_reviewed = TRUE WHERE id = $1",
      [appointment_id]
    );

    await client.query("COMMIT");

    res.status(201).json({
      status: "success",
      data: result.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error creating review:", error);
    res.status(500).json({
      status: "error",
      message: "Error creating review",
    });
  } finally {
    client.release();
  }
};

module.exports = {
  getAllReviews,
  getAllReviewOfSingleDoctor,
  createReview
};
