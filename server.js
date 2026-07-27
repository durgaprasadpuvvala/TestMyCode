const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// --- DATABASE CONFIGURATION ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

pool.connect((err) => {
    if (err) console.error("❌ Database connection failed:", err.stack);
    else console.log("✅ PostgreSQL Connected successfully");
});

// --- CODE EXECUTION HELPER ---
const executeCode = (code, language, input, callback) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    const workDir = path.join(__dirname, `temp_${id}`);
    
    if (!fs.existsSync(workDir)) fs.mkdirSync(workDir);

    let filename = "";
    let command = "";
    let compileCmd = "";

    if (language === "python") {
        filename = "solution.py";
        command = `python3 ${filename}`;
        fs.writeFileSync(path.join(workDir, filename), code);
    } 
    else if (language === "c") {
        filename = "solution.c";
        const exeName = "solution.out";
        compileCmd = `gcc ${filename} -o ${exeName}`;
        command = `./${exeName}`;
        fs.writeFileSync(path.join(workDir, filename), code);
    } 
    else if (language === "java") {
        const classMatch = code.match(/public\s+class\s+(\w+)/);
        const className = classMatch ? classMatch[1] : "Main";
        filename = `${className}.java`;
        compileCmd = `javac ${filename}`;
        command = `java ${className}`;
        fs.writeFileSync(path.join(workDir, filename), code);
    }

    if (!command) {
        fs.rmSync(workDir, { recursive: true, force: true });
        return callback("Language not supported", null);
    }

    const runExecution = () => {
        const processExec = exec(command, { 
            cwd: workDir, 
            timeout: 5000 
        }, (error, stdout, stderr) => {
            fs.rmSync(workDir, { recursive: true, force: true });

            if (error && error.killed) return callback("Execution Timed Out (5s limit)", null);
            if (stderr) return callback(stderr, null);
            callback(null, stdout.trim());
        });

        if (input && input !== "None") {
            processExec.stdin.write(input + "\n");
        }
        processExec.stdin.end();
    };

    if (compileCmd) {
        exec(compileCmd, { cwd: workDir }, (compileError, stdout, compileStderr) => {
            if (compileError || compileStderr) {
                const err = compileStderr || compileError.message;
                fs.rmSync(workDir, { recursive: true, force: true });
                return callback(err, null);
            }
            runExecution();
        });
    } else {
        runExecution();
    }
};

// --- ROUTES ---

app.get("/questions", async (req, res) => {
    try {
        const results = await pool.query("SELECT * FROM questions ORDER BY id ASC");
        res.json(results.rows);
    } catch (err) {
        res.status(500).json([]);
    }
});

app.post("/add-question", async (req, res) => {
    const { title, description, test_cases, language = "python" } = req.body;
    const sql = `INSERT INTO questions (title, description, language, test_cases) VALUES ($1, $2, $3, $4)`;
    try {
        await pool.query(sql, [title, description, language, JSON.stringify(test_cases)]);
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

app.post("/run", async (req, res) => {
    const { code, language, questionId } = req.body;
    try {
        const qResult = await pool.query("SELECT test_cases FROM questions WHERE id = $1", [questionId]);
        if (qResult.rows.length === 0) return res.json({ success: false, results: [] });

        let testCases = typeof qResult.rows[0].test_cases === 'string' 
            ? JSON.parse(qResult.rows[0].test_cases) 
            : qResult.rows[0].test_cases;

        const resultsSummary = [];
        
        for (let test of testCases) {
            const output = await new Promise((resolve) => {
                executeCode(code, language, test.input, (err, out) => resolve(out || err || ""));
            });

            const isPassed = output.toString().trim() === test.output.toString().trim();
            resultsSummary.push({
                passed: isPassed,
                output: output.toString().trim(),
                expected: test.output.toString().trim()
            });
        }
        res.json({ success: true, results: resultsSummary });
    } catch (err) {
        res.status(500).json({ error: "Server Error" });
    }
});

// GET USER SUBMISSIONS (To highlight submitted pills in UI)
app.get("/user-submissions/:id", async (req, res) => {
    const username = req.params.id;
    try {
        const result = await pool.query("SELECT question_id FROM submissions WHERE username = $1", [username]);
        const submittedQuestions = result.rows.map(r => r.question_id);
        res.json({ success: true, submittedQuestions });
    } catch (err) {
        res.status(500).json({ success: false, submittedQuestions: [] });
    }
});

// SUBMIT ROUTE: Overwrites old code & score with latest attempt for that question
app.post("/submit", async (req, res) => {
    const { code, language, questionId, username, timeSpent } = req.body;
    
    if (!username) return res.status(400).json({ success: false, error: "Student ID missing" });

    try {
        const qResult = await pool.query("SELECT test_cases FROM questions WHERE id = $1", [questionId]);
        if (qResult.rows.length === 0) return res.json({ success: false, error: "Question not found" });

        let testCases = typeof qResult.rows[0].test_cases === 'string' 
            ? JSON.parse(qResult.rows[0].test_cases) 
            : qResult.rows[0].test_cases;

        let passedCount = 0;
        for (let test of testCases) {
            const output = await new Promise((resolve) => {
                executeCode(code, language, test.input, (err, out) => resolve(out || ""));
            });
            if (output.toString().trim() === test.output.toString().trim()) passedCount++;
        }

        const currentQuestionScore = passedCount * 5;

        // UPSERT INTO SUBMISSIONS TABLE (Overwrites existing attempt for same question)
        const upsertSubmissionSql = `
            INSERT INTO submissions (username, question_id, code, language, score, time_taken, submitted_at)
            VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
            ON CONFLICT (username, question_id) 
            DO UPDATE SET 
                code = EXCLUDED.code,
                language = EXCLUDED.language,
                score = EXCLUDED.score,
                time_taken = EXCLUDED.time_taken,
                submitted_at = CURRENT_TIMESTAMP;
        `;
        
        await pool.query(upsertSubmissionSql, [username, questionId, code, language, currentQuestionScore, timeSpent || 0]);

        res.json({ success: true, scoreEarned: currentQuestionScore });

    } catch (err) {
        console.error("SUBMIT ERROR:", err);
        res.status(500).json({ success: false, error: "Database Error: " + err.message });
    }
});

// ANALYTICS: Sums up scores from the 'submissions' table (Takes only the latest per question)
app.get("/analytics", async (req, res) => {
    const sql = `
        SELECT 
            sub.username AS student_id, 
            s.student_name, 
            s.student_course, 
            SUM(sub.score) AS total_score, 
            COUNT(sub.question_id) AS total_attempts, 
            SUM(sub.time_taken) AS total_seconds, 
            MAX(sub.submitted_at) AS last_submitted 
        FROM submissions sub
        LEFT JOIN students s ON sub.username = s.student_id
        GROUP BY sub.username, s.student_name, s.student_course
        ORDER BY total_score DESC, total_seconds ASC`;
    try {
        const results = await pool.query(sql);
        res.json(results.rows);
    } catch (err) {
        res.status(500).json({ error: "Database query failed" });
    }
});

app.post("/login", async (req, res) => {
    const { studentId, studentName, studentCourse, password } = req.body;
    try {
        const result = await pool.query("SELECT * FROM students WHERE student_id = $1", [studentId]);
        
        if (result.rows.length === 0) {
            await pool.query(
                "INSERT INTO students (student_id, student_name, student_course, password) VALUES ($1, $2, $3, $4)", 
                [studentId, studentName, studentCourse || 'N/A', password]
            );
        } else {
            await pool.query(
                "UPDATE students SET student_name = $1, student_course = $2 WHERE student_id = $3",
                [studentName, studentCourse, studentId]
            );
        }
        res.json({ success: true });
    } catch (err) {
        console.error("Login Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.delete("/clear-analytics", async (req, res) => {
    try {
        await pool.query("DELETE FROM submissions");
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

// --- DELETE QUESTION ENDPOINT ---

// Express.js Backend Example
app.get('/questions/:id', async (req, res) => {
    const { id } = req.params;

    try {
        // 1. Query database using parameterized query
        const result = await db.query('SELECT * FROM questions WHERE id = $1', [parseInt(id, 10)]);

        if (!result.rows || result.rows.length === 0) {
            return res.status(404).json({ error: 'Question not found' });
        }

        const question = result.rows[0];

        // 2. Safely parse test_cases (handles both String and JSON object types)
        if (typeof question.test_cases === 'string') {
            try {
                question.test_cases = JSON.parse(question.test_cases);
            } catch (pErr) {
                console.error("JSON parse warning:", pErr);
                question.test_cases = [];
            }
        }

        // 3. Return question data
        res.json(question);

    } catch (err) {
        console.error("Server error on GET /questions/:id ->", err);
        res.status(500).json({ error: 'Database query failed', details: err.message });
    }
});
// --- DELETE QUESTION ENDPOINT ---
app.delete("/delete-question/:id", async (req, res) => {
    const { id } = req.params;

    try {
        // 1. First delete references in submissions table to prevent foreign key errors
        await pool.query("DELETE FROM submissions WHERE question_id = $1", [id]);

        // 2. Delete the question itself
        const result = await pool.query("DELETE FROM questions WHERE id = $1", [id]);

        if (result.rowCount === 0) {
            return res.json({ success: false, error: "Question not found" });
        }

        res.json({ success: true, message: "Question deleted successfully" });
    } catch (err) {
        console.error("DELETE QUESTION ERROR:", err);
        res.json({ success: false, error: err.message });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));