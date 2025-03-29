const { body } = require("express-validator");

const appointmentValidation = [
  body("doctor_id").isInt().withMessage("Doctor ID must be a number"),
  body("appointment_date")
    .isDate()
    .withMessage("Appointment date must be a valid date")
    .custom((value) => {
      const date = new Date(value);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (date < today) {
        throw new Error("Appointment date cannot be in the past");
      }
      return true;
    }),
  body("time_slot_id").isInt().withMessage("Time slot ID must be a number"),
  body("consultation_type")
    .isIn(["online", "offline"])
    .withMessage("Consultation type must be online or offline"),
];

module.exports = {
  appointmentValidation,
};
