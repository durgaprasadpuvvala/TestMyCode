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

app.get('/questions/:id', async (req, res) => {
    const { id } = req.params;

    try {
        // FIXED: Changed db.query to pool.query
        const result = await pool.query('SELECT * FROM questions WHERE id = $1', [parseInt(id, 10)]);

        if (!result.rows || result.rows.length === 0) {
            return res.status(404).json({ error: 'Question not found' });
        }

        const question = result.rows[0];

        if (typeof question.test_cases === 'string') {
            try {
                question.test_cases = JSON.parse(question.test_cases);
            } catch (pErr) {
                console.error("JSON parse warning:", pErr);
                question.test_cases = [];
            }
        }

        res.json(question);

    } catch (err) {
        console.error("Server error on GET /questions/:id ->", err);
        res.status(500).json({ error: 'Database query failed', details: err.message });
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

// SUBMIT ROUTE: Overwrites old code & score with latest attempt
app.post("/submit", async (req, res) => {

    const {
        code,
        language,
        questionId,
        username,
        timeSpent
    } = req.body;

    if (!username) {
        return res.status(400).json({
            success: false,
            error: "Student ID missing"
        });
    }

    if (!questionId) {
        return res.status(400).json({
            success: false,
            error: "Question ID missing"
        });
    }

    if (!code) {
        return res.status(400).json({
            success: false,
            error: "Code is empty"
        });
    }

    const client = await pool.connect();

    try {

        await client.query("BEGIN");

        // -----------------------------------------
        // 1. Check student
        // -----------------------------------------

        const studentResult = await client.query(
            "SELECT student_id FROM students WHERE student_id = $1",
            [username]
        );

        if (studentResult.rows.length === 0) {
            throw new Error("Student not found: " + username);
        }

        // -----------------------------------------
        // 2. Get question
        // -----------------------------------------

        const qResult = await client.query(
            "SELECT test_cases FROM questions WHERE id = $1",
            [questionId]
        );

        if (qResult.rows.length === 0) {
            throw new Error("Question not found: " + questionId);
        }

        let testCases = qResult.rows[0].test_cases;

        if (typeof testCases === "string") {
            testCases = JSON.parse(testCases);
        }

        if (!Array.isArray(testCases)) {
            testCases = [];
        }

        // -----------------------------------------
        // 3. Run test cases
        // -----------------------------------------

        let passedCount = 0;

        for (const test of testCases) {

            const output = await new Promise((resolve) => {

                executeCode(
                    code,
                    language,
                    test.input,
                    (err, out) => {
                        resolve(out || "");
                    }
                );

            });

            const actualOutput = output
                .toString()
                .trim();

            const expectedOutput = test.output
                .toString()
                .trim();

            if (actualOutput === expectedOutput) {
                passedCount++;
            }
        }

        // 5 marks per test case
        const currentQuestionScore = passedCount * 5;

        const safeTime = Math.max(
            0,
            parseInt(timeSpent || 0)
        );

        // -----------------------------------------
        // 4. Save submission
        // -----------------------------------------

        const submissionSql = `
            INSERT INTO submissions
            (
                username,
                question_id,
                code,
                language,
                score,
                time_taken,
                submitted_at
            )
            VALUES
            ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)

            ON CONFLICT (username, question_id)

            DO UPDATE SET
                code = EXCLUDED.code,
                language = EXCLUDED.language,
                score = EXCLUDED.score,
                time_taken = EXCLUDED.time_taken,
                submitted_at = CURRENT_TIMESTAMP
        `;

        await client.query(submissionSql, [
            username,
            questionId,
            code,
            language,
            currentQuestionScore,
            safeTime
        ]);

        // -----------------------------------------
        // 5. Update overall results
        // -----------------------------------------

        const resultSql = `
            INSERT INTO results
            (
                username,
                score,
                time_taken,
                attempts,
                created_at,
                submitted_at
            )
            VALUES
            (
                $1,
                $2,
                $3,
                1,
                CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP
            )

            ON CONFLICT (username)

            DO UPDATE SET
                score = (
                    SELECT COALESCE(SUM(score), 0)
                    FROM submissions
                    WHERE username = $1
                ),

                time_taken = (
                    SELECT COALESCE(SUM(time_taken), 0)
                    FROM submissions
                    WHERE username = $1
                ),

                attempts = (
                    SELECT COUNT(*)
                    FROM submissions
                    WHERE username = $1
                ),

                submitted_at = CURRENT_TIMESTAMP
        `;

        await client.query(resultSql, [
            username,
            currentQuestionScore,
            safeTime
        ]);

        await client.query("COMMIT");

        console.log(
            `✅ Submission saved: Student=${username}, Question=${questionId}, Score=${currentQuestionScore}`
        );

        res.json({
            success: true,
            scoreEarned: currentQuestionScore,
            questionId: questionId
        });

    } catch (err) {

        await client.query("ROLLBACK");

        console.error("❌ SUBMIT ERROR:", err);

        res.status(500).json({
            success: false,
            error: err.message
        });

    } finally {

        client.release();

    }
});
// FIXED ANALYTICS ROUTE: Prevents negative duration calculations
app.get("/analytics", async (req, res) => {

    try {

        const query = `
            SELECT
                r.username AS student_id,
                s.student_name,
                s.student_course,

                r.attempts AS total_attempts,

                r.score AS total_score,

                r.time_taken AS total_seconds,

                r.created_at AS start_time,

                r.submitted_at AS last_submitted

            FROM results r

            LEFT JOIN students s
                ON r.username = s.student_id

            ORDER BY r.submitted_at DESC
        `;

        const { rows } = await pool.query(query);

        res.json(rows);

    } catch (err) {

        console.error("❌ Error fetching analytics:", err);

        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

// Route to handle student registration
app.post('/register', async (req, res) => {
    const { studentId, studentName, studentCourse, phone, email, password } = req.body;

    // Validate required fields
    if (!studentId || !studentName || !password) {
        return res.status(400).json({ success: false, message: 'Student ID, Name, and Password are required.' });
    }

    try {
        // Insert query into PostgreSQL students table
        const query = `
            INSERT INTO students (student_id, student_name, student_course, phone, email, password)
            VALUES ($1, $2, $3, $4, $5, $6)
        `;

        const values = [studentId, studentName, studentCourse, phone, email, password];
        
        await pool.query(query, values);

        return res.status(200).json({ success: true, message: 'Registration successful!' });

    } catch (err) {
        console.error('Registration error:', err.message);

        // PostgreSQL error code 23505 indicates a unique violation (e.g., student_id already exists)
        if (err.code === '23505') {
            return res.status(400).json({ success: false, message: 'Student ID already exists. Try logging in.' });
        }

        return res.status(500).json({ success: false, message: 'Internal server error during registration.' });
    }
});
// Route to handle candidate login
app.post('/login', async (req, res) => {
    const { studentId, password } = req.body;

    // Validate input fields
    if (!studentId || !password) {
        return res.status(400).json({ success: false, message: 'Student ID and Password are required.' });
    }

    try {
        // Query the database for the student record matching student_id
        const query = 'SELECT * FROM students WHERE student_id = $1';
        const result = await pool.query(query, [studentId]);

        // Check if student exists
        if (result.rows.length === 0) {
            return res.status(401).json({ success: false, message: 'Authentication Error: Student ID not found.' });
        }

        const student = result.rows[0];

        // Verify password (Note: In production, use bcrypt.compare() if passwords are hashed)
        if (student.password !== password) {
            return res.status(401).json({ success: false, message: 'Authentication Error: Invalid credentials.' });
        }

        // Authentication successful: pass success flag and student name back to the frontend
        return res.status(200).json({
            success: true,
            message: 'Login successful!',
            studentName: student.student_name // Passed to match your frontend redirect logic
        });

    } catch (err) {
        console.error('Login error:', err.message);
        return res.status(500).json({ success: false, message: 'Internal server error during authentication.' });
    }
});

// Route to handle password reset requests

// In-memory store for OTPs (For production scaling, consider using Redis or a database table)
const otpStorage = {};

// 1. Route to handle sending OTP via Phone Number
app.post('/send-otp', async (req, res) => {
    const { studentId, phone } = req.body;

    // Validate inputs
    if (!studentId || !phone) {
        return res.status(400).json({ success: false, message: 'Student ID and Phone Number are required.' });
    }

    try {
        // Query the database to check if student ID and phone match an existing record
        const query = 'SELECT * FROM students WHERE student_id = $1 AND phone = $2';
        const result = await pool.query(query, [studentId, phone]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'No account found matching this Student ID and Phone Number.' });
        }

        // Generate a random 6-digit OTP
        const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
        
        // Store OTP with an expiration time of 5 minutes
        otpStorage[studentId] = {
            otp: generatedOtp,
            expiresAt: Date.now() + 5 * 60 * 1000 
        };

        // Output to server console (Integrate Twilio or SMS API here for live deployment)
        console.log(`[OTP Service] OTP for Student ID ${studentId}: ${generatedOtp}`);

        return res.status(200).json({ 
            success: true, 
            message: 'OTP sent successfully to your registered mobile number.' 
        });

    } catch (err) {
        console.error('Send OTP error:', err.message);
        return res.status(500).json({ success: false, message: 'Internal server error while sending OTP.' });
    }
});

// 2. Route to handle OTP verification and update the password
app.post('/send-otp', async (req, res) => {
    const { studentId, phone } = req.body;

    if (!studentId || !phone) {
        return res.status(400).json({ success: false, message: 'Student ID and Phone Number are required.' });
    }

    try {
        const query = 'SELECT * FROM students WHERE student_id = $1 AND phone = $2';
        const result = await pool.query(query, [studentId, phone]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'No account found matching this Student ID and Phone Number.' });
        }

        const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
        
        otpStorage[studentId] = {
            otp: generatedOtp,
            expiresAt: Date.now() + 5 * 60 * 1000 
        };

        // FOR FREE TESTING: Send the OTP back in the response object so it shows up easily
        console.log(`[Free Dev OTP] Student ${studentId} OTP: ${generatedOtp}`);

        return res.status(200).json({ 
            success: true, 
            message: 'OTP generated successfully!',
            debugOtp: generatedOtp // Remove this line when you finally deploy live!
        });

    } catch (err) {
        console.error('Error:', err.message);
        return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
});

// FIXED CLEAR ALL RESULTS: Truncates both submissions and results tables
app.delete("/clear-analytics", async (req, res) => {
    try {
        await pool.query("BEGIN");
        await pool.query("DELETE FROM submissions");
        await pool.query("DELETE FROM results");
        await pool.query("COMMIT");
        
        res.json({ success: true, message: "All analytics cleared successfully" });
    } catch (err) {
        await pool.query("ROLLBACK");
        console.error("CLEAR ERROR:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.delete("/delete-question/:id", async (req, res) => {
    const { id } = req.params;

    try {
        await pool.query("DELETE FROM submissions WHERE question_id = $1", [id]);
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