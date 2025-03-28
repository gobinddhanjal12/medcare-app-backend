const express = require("express");
const router = express.Router();
const { verifyToken, checkRole } = require("../middleware/auth");
const { appointmentValidation } = require("../middleware/validation");
const {
  availableSlots,
  createAppointment,
  getAppointmentById,
  getPatientAppointment,
} = require("../controllers/appointmentController");

router.get("/available-slots/:doctorId", availableSlots);
router.post(
  "/",
  [verifyToken, checkRole(["patient"]), ...appointmentValidation],
  createAppointment
);
router.get(
  "/patient",
  [verifyToken, checkRole(["patient"])],
  getPatientAppointment
);
router.get("/:id", [verifyToken], getAppointmentById);

module.exports = router;
