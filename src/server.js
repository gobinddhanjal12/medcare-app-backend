require("dotenv").config();
require("./config/passport");
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const passport = require("passport");
const authRoutes = require("./routes/auth");
const doctorRoutes = require("./routes/doctors");
const appointmentRoutes = require("./routes/appointments");
const adminRoutes = require("./routes/admin");
const reviewRoutes = require("./routes/reviews");
const cookieParser = require("cookie-parser");

const app = express();

const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.ADMIN_FRONTEND_URL,
];

app.use(cookieParser());
app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      } else {
        return callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization", "x-admin-secret"],
    exposedHeaders: ["Content-Range", "X-Content-Range"],
    credentials: true,
  })
);
app.use(morgan("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(passport.initialize());

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/doctors", doctorRoutes);
app.use("/api/v1/appointments", appointmentRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/reviews", reviewRoutes);

app.use((req, res) => {
  res.status(404).json({
    status: "error",
    message: "Route not found",
  });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    status: "error",
    message: "Something went wrong!",
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
