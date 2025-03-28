const express = require("express");
const router = express.Router();
const {
  getDoctorById,
  doctorFilter,
} = require("../controllers/doctorController");

router.get("/filter", doctorFilter);
router.get("/:id", getDoctorById);

module.exports = router;
