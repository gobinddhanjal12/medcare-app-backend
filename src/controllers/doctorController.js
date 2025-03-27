const pool = require("../config/database");

const getDoctorById = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT d.*, u.name, u.email,
                    COALESCE(AVG(r.rating), 0) as average_rating,
                    COUNT(r.id) as total_reviews
             FROM doctors d
             JOIN users u ON d.user_id = u.id
             LEFT JOIN reviews r ON d.id = r.doctor_id
             WHERE d.id = $1
             GROUP BY d.id, u.id`,
      [req.params.id]
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
    console.error("Get doctor by ID error:", error);
    res.status(500).json({
      status: "error",
      message: "Error fetching doctor",
    });
  }
};

module.exports = {
  getDoctorById,
};
