// require("dotenv").config();
// const { Pool } = require("pg");

// const pool = new Pool({
//   host: process.env.DB_HOST || "localhost",
//   port: process.env.DB_PORT || 5432,
//   database: process.env.DB_NAME || "medcare_db",
//   user: process.env.DB_USER || "postgres",
//   password: process.env.DB_PASSWORD || "postgres",
//   ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
// });

// pool.connect((err, client, release) => {
//   if (err) {
//     return console.error("Error acquiring client", err.stack);
//   }
//   console.log("Successfully connected to PostgreSQL database");
//   release();
// });

// module.exports = pool;

require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
});

pool.connect((err, client, release) => {
  if (err) {
    return console.error("Error acquiring client", err.stack);
  }
  console.log("Successfully connected to PostgreSQL database");
  release();
});

module.exports = pool;
