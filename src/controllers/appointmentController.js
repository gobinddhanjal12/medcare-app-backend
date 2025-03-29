const pool = require("../config/database");
const { validationResult } = require("express-validator");
const { sendAppointmentConfirmation } = require("../services/emailService");

const availableSlots = async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) {
      return res.status(400).json({
        status: "error",
        message: "Date is required",
      });
    }

    const doctorCheck = await pool.query(
      "SELECT id FROM doctors WHERE id = $1",
      [req.params.doctorId]
    );

    if (doctorCheck.rows.length === 0) {
      return res.status(404).json({
        status: "error",
        message: "Doctor not found",
      });
    }

    const slotsResult = await pool.query(
      "SELECT * FROM time_slots ORDER BY start_time"
    );

    const bookedSlotsResult = await pool.query(
      `SELECT time_slot_id 
         FROM appointments 
         WHERE doctor_id = $1 
         AND appointment_date = $2 
         AND status = 'approved'
         AND status != 'cancelled'`,
      [req.params.doctorId, date]
    );

    const bookedSlotIds = bookedSlotsResult.rows.map(
      (slot) => slot.time_slot_id
    );

    const availableSlots = slotsResult.rows.filter(
      (slot) => !bookedSlotIds.includes(slot.id)
    );

    res.json({
      status: "success",
      data: availableSlots,
    });
  } catch (error) {
    console.error("Get available slots error:", error);
    res.status(500).json({
      status: "error",
      message: "Error fetching available slots",
    });
  }
};

const createAppointment = async (req, res) => {
  const client = await pool.connect();
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        status: "error",
        message: "Validation failed",
        errors: errors.array(),
      });
    }

    const {
      doctor_id,
      appointment_date,
      time_slot_id,
      consultation_type,
      patient_age,
      patient_gender,
      health_info,
    } = req.body;

    const formattedDate = new Date(appointment_date)
      .toISOString()
      .split("T")[0];

    await client.query("BEGIN");

    const doctorResult = await client.query(
      `SELECT u.name as doctor_name, ts.start_time, ts.end_time
         FROM doctors d
         JOIN users u ON d.user_id = u.id
         JOIN time_slots ts ON ts.id = $1
         WHERE d.id = $2`,
      [time_slot_id, doctor_id]
    );

    if (doctorResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        status: "error",
        message: "Doctor or time slot not found",
      });
    }

    const doctor = doctorResult.rows[0];

    const result = await client.query(
      `INSERT INTO appointments (
          doctor_id,
          patient_id,
          appointment_date,
          time_slot_id,
          consultation_type,
          patient_age,
          patient_gender,
          health_info,
          status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
        RETURNING *`,
      [
        doctor_id,
        req.user.id,
        formattedDate,
        time_slot_id,
        consultation_type,
        patient_age,
        patient_gender,
        health_info,
      ]
    );

    if (req.user.email) {
      try {
        await sendAppointmentConfirmation({
          patient_email: req.user.email,
          patient_name: req.user.name,
          doctor_name: doctor.doctor_name,
          appointment_date: formattedDate,
          start_time: doctor.start_time,
          end_time: doctor.end_time,
          consultation_type,
        });
      } catch (emailError) {
        console.error("Error sending confirmation email:", emailError);
      }
    }

    await client.query("COMMIT");

    res.status(201).json({
      status: "success",
      message:
        "Appointment request submitted successfully. Waiting for admin approval.",
      data: result.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Create appointment error:", error);
    res.status(500).json({
      status: "error",
      message: "Error creating appointment request",
    });
  } finally {
    client.release();
  }
};

const getPatientAppointment = async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT 
        a.*,
        u.name as doctor_name,
        ts.start_time,
        ts.end_time,
        CASE 
          WHEN a.status = 'approved' AND NOT a.is_reviewed THEN true 
          ELSE false 
        END as can_review
      FROM appointments a
      JOIN doctors d ON a.doctor_id = d.id
      JOIN users u ON d.user_id = u.id
      JOIN time_slots ts ON a.time_slot_id = ts.id
      WHERE a.patient_id = $1
    `;
    const queryParams = [req.user.id];

    if (status) {
      query += ` AND a.status = $${queryParams.length + 1}`;
      queryParams.push(status);
    }

    const countQuery = `
      SELECT COUNT(*) 
      FROM appointments a
      WHERE a.patient_id = $1
      ${status ? "AND a.status = $2" : ""}
    `;
    const countParams = status ? [req.user.id, status] : [req.user.id];
    const totalCount = await pool.query(countQuery, countParams);

    query += ` ORDER BY a.appointment_date DESC, ts.start_time DESC LIMIT $${
      queryParams.length + 1
    } OFFSET $${queryParams.length + 2}`;
    queryParams.push(limit, offset);

    const result = await pool.query(query, queryParams);

    const total = parseInt(totalCount.rows[0].count);
    const pages = Math.ceil(total / limit);

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
    console.error("Get patient appointments error:", error);
    res.status(500).json({
      status: "error",
      message: "Error fetching appointments",
    });
  }
};

const getAppointmentById = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
          a.*,
          d.specialty,
          d.location,
          d.consultation_fee,
          u.name as doctor_name,
          u.email as doctor_email,
          p.name as patient_name,
          p.email as patient_email,
          ts.start_time,
          ts.end_time
        FROM appointments a
        JOIN doctors d ON a.doctor_id = d.id
        JOIN users u ON d.user_id = u.id
        JOIN users p ON a.patient_id = p.id
        JOIN time_slots ts ON a.time_slot_id = ts.id
        WHERE a.id = $1 AND (a.patient_id = $2 OR u.id = $2)`,
      [req.params.id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: "error",
        message: "Appointment not found or unauthorized",
      });
    }

    res.json({
      status: "success",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Get appointment details error:", error);
    res.status(500).json({
      status: "error",
      message: "Error fetching appointment details",
    });
  }
};


module.exports = {
  availableSlots,
  createAppointment,
  getPatientAppointment,
  getAppointmentById,
};
