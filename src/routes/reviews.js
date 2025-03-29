const express = require("express");
const {
  getAllReviewOfSingleDoctor,
  getAllReviews,
  createReview,
} = require("../controllers/reviewController");
const router = express.Router();
const { verifyToken, checkRole } = require("../middleware/auth");

router.post("/", [verifyToken, checkRole(["patient"])], createReview);

router.get("/", getAllReviews);

router.get("/doctor/:doctorId", getAllReviewOfSingleDoctor);

module.exports = router;
