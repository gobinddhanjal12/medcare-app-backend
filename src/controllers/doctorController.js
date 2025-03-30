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

const doctorFilter = async (req, res) => {
  try {
    const {
      gender,
      specialty,
      experience,
      rating,
      name,
      max_experience,
      page = 1,
      limit = 6,
    } = req.query;
    const offset = (page - 1) * limit;

    let baseQuery = `
      FROM doctors d
      JOIN users u ON d.user_id = u.id
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

    if (max_experience) {
      baseQuery += ` AND d.experience <= $${paramCount}`;
      queryParams.push(parseInt(max_experience));
      paramCount++;
    }

    if (rating && !isNaN(parseFloat(rating))) {
      const minRating = parseFloat(rating);
      const maxRating = minRating + 1;
      baseQuery += ` AND d.average_rating >= $${paramCount} AND d.average_rating < $${
        paramCount + 1
      }`;
      queryParams.push(minRating, maxRating);
      paramCount += 2;
    }

    const countQuery = `SELECT COUNT(*) FROM (SELECT d.id ${baseQuery}) AS filtered_doctors`;

    const selectQuery = `
      SELECT 
        d.*,
        u.name,
        u.email
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
};

module.exports = {
  getDoctorById,
  doctorFilter,
};
