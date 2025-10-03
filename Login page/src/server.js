// server.js
const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const sqlite3 = require("sqlite3");
const bodyParser = require("body-parser");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const SECRET = "supersecretkey"; // ⚠️ change in production

// ---------------- SQLite ----------------
const DB_FILE = "users.db";
const dbExists = fs.existsSync(DB_FILE);
const db = new sqlite3.Database(DB_FILE);

if (!dbExists) {
  db.run(
    "CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT UNIQUE, password TEXT)",
    (err) => {
      if (err) console.error("Failed to create table:", err);
      else console.log("✅ Users table created.");
    }
  );
}

// ---------------- Middleware ----------------
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname))); // serve static frontend files

// ---------------- API ----------------

// Register
app.post("/api/register", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Missing fields" });

  const hashed = await bcrypt.hash(password, 10);
  db.run(
    "INSERT INTO users (username, password) VALUES (?, ?)",
    [username, hashed],
    function (err) {
      if (err) return res.status(400).json({ error: "User already exists" });
      res.json({ message: "Registered successfully" });
    }
  );
});

// Login
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  db.get("SELECT * FROM users WHERE username = ?", [username], async (err, user) => {
    if (!user) return res.status(400).json({ error: "Invalid username" });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ error: "Invalid password" });

    const token = jwt.sign(
      { id: user.id, username: user.username },
      SECRET,
      { expiresIn: "24h" }
    );
    res.json({ message: "Login successful", token });
  });
});

// Forgot password
app.post("/api/forgot", (req, res) => {
  const { username } = req.body;
  const newPass = "new123"; // ⚠️ replace with email reset in production
  bcrypt.hash(newPass, 10).then((hashed) => {
    db.run(
      "UPDATE users SET password = ? WHERE username = ?",
      [hashed, username],
      function (err) {
        if (err || this.changes === 0) return res.status(400).json({ error: "User not found" });
        res.json({ message: `Password reset. Temporary password: ${newPass}` });
      }
    );
  });
});

// Middleware: JWT check
function authenticate(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token provided" });

  jwt.verify(token, SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: "Invalid or expired token" });
    req.user = user;
    next();
  });
}

// Protected dashboard
app.get("/api/dashboard", authenticate, (req, res) => {
  res.json({
    message: `Welcome ${req.user.username}!`,
    secretData: "🔒 This is protected content only you can see."
  });
});

// ---------------- Serve Frontend ----------------
app.get("*", (req, res) => {
  if (!req.path.startsWith("/api")) {
    res.sendFile(path.join(__dirname, "index.html"));
  }
});

// ---------------- Start Server ----------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
