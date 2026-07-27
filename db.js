const mysql = require("mysql2");

const db = mysql.createConnection({
    host: "db",          // ✅ docker service name
    user: "root",
    password: "root",    // ✅ from docker-compose
    database: "coding_exam",
    port: 3306           // ✅ container internal port
});

db.connect(err => {
    if (err) {
        console.log("DB Error:", err);
    } else {
        console.log("MySQL Connected ✅");
    }
});

module.exports = db;