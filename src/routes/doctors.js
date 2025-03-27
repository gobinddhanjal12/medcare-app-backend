const express = require("express");
const router = express.Router();
const { getDoctorById } = require("../controllers/doctorController");
const pool = require("../config/database");

router.get("/filter", async (req, res) => {
  try {
    const {
      gender,
      specialty,
      experience,
      rating,
      name,
      page = 1,
      limit = 6,
    } = req.query;
    const offset = (page - 1) * limit;

    let baseQuery = `
      FROM doctors d
      JOIN users u ON d.user_id = u.id
      LEFT JOIN reviews r ON d.id = r.doctor_id
      WHERE 1=1
    `;

    const queryParams = [];
    let paramCount = 1;

    if (name) {
      baseQuery += ` AND u.name ILIKE $${paramCount}`;
      queryParams.push(`%${name}%`);
      paramCount++;
    }

    if (gender) {
      baseQuery += ` AND d.gender = $${paramCount}`;
      queryParams.push(gender);
      paramCount++;
    }

    if (specialty) {
      baseQuery += ` AND d.specialty ILIKE $${paramCount}`;
      queryParams.push(`%${specialty}%`);
      paramCount++;
    }

    if (experience) {
      baseQuery += ` AND d.experience >= $${paramCount}`;
      queryParams.push(parseInt(experience));
      paramCount++;
    }

    baseQuery += ` GROUP BY d.id, u.name, u.email`;

    if (rating) {
      baseQuery += ` HAVING COALESCE(AVG(r.rating), 0) >= $${paramCount}`;
      queryParams.push(parseFloat(rating));
      paramCount++;
    }

    const countQuery = `SELECT COUNT(*) FROM (SELECT d.id ${baseQuery}) AS filtered_doctors`;

    const selectQuery = `
      SELECT 
        d.*,
        u.name,
        u.email,
        COALESCE(AVG(r.rating), 0)::TEXT as average_rating
      ${baseQuery}
      ORDER BY d.experience DESC 
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `;

    const paginationParams = [limit, offset];

    const [doctors, totalCount] = await Promise.all([
      pool.query(selectQuery, [...queryParams, ...paginationParams]),
      pool.query(countQuery, queryParams),
    ]);

    const total = parseInt(totalCount.rows[0].count);
    const pages = Math.ceil(total / limit);

    res.json({
      status: "success",
      data: doctors.rows,
      pagination: {
        total: total,
        page: parseInt(page),
        pages: pages,
        limit: parseInt(limit),
      },
    });
  } catch (error) {
    console.error("Filter doctors error:", error);
    res.status(500).json({
      status: "error",
      message: "Error filtering doctors",
      details: error.message,
    });
  }
});

router.get("/:id", getDoctorById);

module.exports = router;
