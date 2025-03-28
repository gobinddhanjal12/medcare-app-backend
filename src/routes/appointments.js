const express = require("express");
const router = express.Router();
const pool = require("../config/database");
const { verifyToken, checkRole } = require("../middleware/auth");
const { validationResult } = require("express-validator");
const { appointmentValidation } = require("../middleware/validation");
const { sendAppointmentConfirmation } = require("../services/emailService");

router.get("/available-slots/:doctorId", async (req, res) => {
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
       AND request_status = 'approved'
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
});

router.post(
  "/",
  [verifyToken, checkRole(["patient"]), ...appointmentValidation],
  async (req, res) => {
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
          request_status
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
  }
);

router.patch(
  "/:id/request-status",
  [verifyToken, checkRole(["admin"])],
  async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (!["approved", "rejected"].includes(status)) {
        return res.status(400).json({
          status: "error",
          message: 'Invalid status. Must be either "approved" or "rejected"',
        });
      }

      const appointmentCheck = await pool.query(
        `SELECT a.*, ts.start_time, ts.end_time 
         FROM appointments a
         JOIN time_slots ts ON a.time_slot_id = ts.id
         WHERE a.id = $1`,
        [id]
      );

      if (appointmentCheck.rows.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Appointment not found",
        });
      }

      const appointment = appointmentCheck.rows[0];

      if (status === "approved") {
        const availabilityCheck = await pool.query(
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
          return res.status(400).json({
            status: "error",
            message: `This time slot is already booked by ${availabilityCheck.rows[0].patient_name}`,
          });
        }
      }

      const result = await pool.query(
        "UPDATE appointments SET request_status = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
        [status, id]
      );

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
            appointment.time_slot_id,
            appointment.doctor_id,
            appointment.appointment_date,
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
  }
);

router.get(
  "/patient",
  [verifyToken, checkRole(["patient"])],
  async (req, res) => {
    try {
      const { status, page = 1, limit = 10 } = req.query;
      const offset = (page - 1) * limit;

      let query = `
        SELECT a.*, 
               d.specialty,
               u.name as doctor_name,
               u.email as doctor_email,
               ts.start_time,
               ts.end_time
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
        message: "Error fetching patient appointments",
      });
    }
  }
);

router.get("/:id", [verifyToken], async (req, res) => {
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
});

module.exports = router;
