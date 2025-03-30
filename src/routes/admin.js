const express = require("express");
const router = express.Router();
const { verifyToken, isAdmin } = require("../middleware/auth");
const multer = require("multer");
const {
  createDoctor,
  getPendingAppointments,
  updateAppointmentStatus,
} = require("../controllers/adminController");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Not an image! Please upload an image."), false);
    }
  },
});

router.use(verifyToken, isAdmin);

router.post("/doctors", upload.single("photo"), createDoctor);

router.get("/appointments/pending", getPendingAppointments);

router.patch("/appointments/:id/request-status", updateAppointmentStatus);

module.exports = router;
