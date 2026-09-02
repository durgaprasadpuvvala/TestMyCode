const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));


// ============================================================
// DATABASE CONFIGURATION
// ============================================================

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

pool.connect((err, client, release) => {

    if (err) {
        console.error(
            "❌ Database connection failed:",
            err.stack
        );
    } else {
        console.log(
            "✅ PostgreSQL Connected successfully"
        );
        release();
    }

});


// ============================================================
// CODE EXECUTION HELPER
// ============================================================

const executeCode = (code, language, input, callback) => {

    const id =
        Date.now() +
        Math.floor(Math.random() * 1000);

    const workDir =
        path.join(__dirname, `temp_${id}`);

    try {

        if (!fs.existsSync(workDir)) {
            fs.mkdirSync(workDir, {
                recursive: true
            });
        }

    } catch (err) {

        return callback(
            "Unable to create temporary directory",
            null
        );

    }

    let filename = "";
    let command = "";
    let compileCmd = "";


    // --------------------------------------------------------
    // PYTHON
    // --------------------------------------------------------

    if (language === "python") {

        filename = "solution.py";

        command = `python3 ${filename}`;

        try {

            fs.writeFileSync(
                path.join(workDir, filename),
                code
            );

        } catch (err) {

            fs.rmSync(
                workDir,
                {
                    recursive: true,
                    force: true
                }
            );

            return callback(
                "Unable to create Python file",
                null
            );
        }

    }


    // --------------------------------------------------------
    // C
    // --------------------------------------------------------

    else if (language === "c") {

        filename = "solution.c";

        const exeName = "solution.out";

        compileCmd =
            `gcc ${filename} -o ${exeName}`;

        command =
            `./${exeName}`;

        try {

            fs.writeFileSync(
                path.join(workDir, filename),
                code
            );

        } catch (err) {

            fs.rmSync(
                workDir,
                {
                    recursive: true,
                    force: true
                }
            );

            return callback(
                "Unable to create C file",
                null
            );
        }

    }


    // --------------------------------------------------------
    // JAVA
    // --------------------------------------------------------

    else if (language === "java") {

        const classMatch =
            code.match(
                /public\s+class\s+(\w+)/
            );

        const className =
            classMatch
                ? classMatch[1]
                : "Main";

        filename =
            `${className}.java`;

        compileCmd =
            `javac ${filename}`;

        command =
            `java ${className}`;

        try {

            fs.writeFileSync(
                path.join(workDir, filename),
                code
            );

        } catch (err) {

            fs.rmSync(
                workDir,
                {
                    recursive: true,
                    force: true
                }
            );

            return callback(
                "Unable to create Java file",
                null
            );
        }

    }


    // --------------------------------------------------------
    // UNSUPPORTED LANGUAGE
    // --------------------------------------------------------

    else {

        fs.rmSync(
            workDir,
            {
                recursive: true,
                force: true
            }
        );

        return callback(
            "Language not supported",
            null
        );
    }


    // ========================================================
    // RUN EXECUTION
    // ========================================================

    const runExecution = () => {

        const processExec = exec(
            command,
            {
                cwd: workDir,
                timeout: 5000,
                maxBuffer: 1024 * 1024
            },
            (error, stdout, stderr) => {

                try {

                    fs.rmSync(
                        workDir,
                        {
                            recursive: true,
                            force: true
                        }
                    );

                } catch (cleanupError) {

                    console.error(
                        "Cleanup error:",
                        cleanupError.message
                    );
                }


                // Timeout
                if (
                    error &&
                    error.killed
                ) {

                    return callback(
                        "Execution Timed Out (5s limit)",
                        null
                    );
                }


                // Compilation/runtime error
                if (stderr) {

                    return callback(
                        stderr,
                        null
                    );
                }


                if (error && !stdout) {

                    return callback(
                        error.message,
                        null
                    );
                }


                callback(
                    null,
                    stdout.trim()
                );

            }
        );


        // Send input
        if (
            input !== undefined &&
            input !== null &&
            input !== "" &&
            input !== "None"
        ) {

            try {

                processExec.stdin.write(
                    String(input) + "\n"
                );

            } catch (err) {

                console.error(
                    "Input write error:",
                    err.message
                );
            }
        }

        try {

            processExec.stdin.end();

        } catch (err) {

            console.error(
                "stdin close error:",
                err.message
            );
        }

    };


    // ========================================================
    // COMPILE FIRST IF REQUIRED
    // ========================================================

    if (compileCmd) {

        exec(
            compileCmd,
            {
                cwd: workDir,
                timeout: 5000,
                maxBuffer: 1024 * 1024
            },
            (
                compileError,
                stdout,
                compileStderr
            ) => {

                if (
                    compileError ||
                    compileStderr
                ) {

                    const err =
                        compileStderr ||
                        (
                            compileError
                                ? compileError.message
                                : "Compilation failed"
                        );

                    fs.rmSync(
                        workDir,
                        {
                            recursive: true,
                            force: true
                        }
                    );

                    return callback(
                        err,
                        null
                    );
                }

                runExecution();
            }
        );

    } else {

        runExecution();

    }

};


// ============================================================
// GET ALL QUESTIONS
// ============================================================

app.get(
    "/questions",
    async (req, res) => {

        try {

            const results =
                await pool.query(
                    `
                    SELECT *
                    FROM questions
                    ORDER BY id ASC
                    `
                );

            res.json(
                results.rows
            );

        } catch (err) {

            console.error(
                "GET QUESTIONS ERROR:",
                err
            );

            res.status(500).json([]);

        }

    }
);


// ============================================================
// GET SINGLE QUESTION
// ============================================================

app.get(
    "/questions/:id",
    async (req, res) => {

        const id =
            parseInt(
                req.params.id,
                10
            );

        if (isNaN(id)) {

            return res.status(400).json({
                error: "Invalid question ID"
            });

        }

        try {

            const result =
                await pool.query(
                    `
                    SELECT *
                    FROM questions
                    WHERE id = $1
                    `,
                    [id]
                );

            if (
                !result.rows ||
                result.rows.length === 0
            ) {

                return res.status(404).json({
                    error: "Question not found"
                });

            }

            const question =
                result.rows[0];


            if (
                typeof question.test_cases ===
                "string"
            ) {

                try {

                    question.test_cases =
                        JSON.parse(
                            question.test_cases
                        );

                } catch (pErr) {

                    console.error(
                        "JSON parse warning:",
                        pErr
                    );

                    question.test_cases = [];

                }

            }


            res.json(
                question
            );

        } catch (err) {

            console.error(
                "Server error on GET /questions/:id:",
                err
            );

            res.status(500).json({
                error: "Database query failed",
                details: err.message
            });

        }

    }
);


// ============================================================
// ADD QUESTION
// ============================================================

app.post(
    "/add-question",
    async (req, res) => {

        const {
            title,
            description,
            test_cases,
            language = "python"
        } = req.body;


        if (
            !title ||
            !description
        ) {

            return res.status(400).json({
                success: false,
                error: "Title and description are required."
            });

        }


        try {

            const sql = `
                INSERT INTO questions
                (
                    title,
                    description,
                    language,
                    test_cases
                )
                VALUES
                (
                    $1,
                    $2,
                    $3,
                    $4
                )
            `;


            await pool.query(
                sql,
                [
                    title,
                    description,
                    language,
                    JSON.stringify(
                        Array.isArray(test_cases)
                            ? test_cases
                            : []
                    )
                ]
            );


            res.json({
                success: true,
                message: "Question added successfully."
            });


        } catch (err) {

            console.error(
                "ADD QUESTION ERROR:",
                err
            );

            res.json({
                success: false,
                error: err.message
            });

        }

    }
);


// ============================================================
// UPDATE QUESTION
// ============================================================

app.put(
    "/update-question/:id",
    async (req, res) => {

        const id =
            parseInt(
                req.params.id,
                10
            );

        const {
            title,
            description,
            test_cases,
            language = "python"
        } = req.body;


        if (isNaN(id)) {

            return res.status(400).json({
                success: false,
                error: "Invalid question ID."
            });

        }


        if (
            !title ||
            !description
        ) {

            return res.status(400).json({
                success: false,
                error: "Title and description are required."
            });

        }


        try {

            const result =
                await pool.query(
                    `
                    UPDATE questions
                    SET
                        title = $1,
                        description = $2,
                        language = $3,
                        test_cases = $4
                    WHERE id = $5
                    `,
                    [
                        title,
                        description,
                        language,
                        JSON.stringify(
                            Array.isArray(test_cases)
                                ? test_cases
                                : []
                        ),
                        id
                    ]
                );


            if (
                result.rowCount === 0
            ) {

                return res.status(404).json({
                    success: false,
                    error: "Question not found."
                });

            }


            res.json({
                success: true,
                message: "Question updated successfully."
            });


        } catch (err) {

            console.error(
                "UPDATE QUESTION ERROR:",
                err
            );

            res.status(500).json({
                success: false,
                error: err.message
            });

        }

    }
);


// ============================================================
// RUN CODE AGAINST ALL TEST CASES
// ============================================================

app.post(
    "/run",
    async (req, res) => {

        const {
            code,
            language,
            questionId
        } = req.body;


        if (!code) {

            return res.json({
                success: false,
                results: [],
                error: "Code is empty."
            });

        }


        if (!language) {

            return res.json({
                success: false,
                results: [],
                error: "Language is required."
            });

        }


        if (!questionId) {

            return res.json({
                success: false,
                results: [],
                error: "Question ID is required."
            });

        }


        try {

            const qResult =
                await pool.query(
                    `
                    SELECT test_cases
                    FROM questions
                    WHERE id = $1
                    `,
                    [questionId]
                );


            if (
                qResult.rows.length === 0
            ) {

                return res.json({
                    success: false,
                    results: [],
                    error: "Question not found."
                });

            }


            let testCases =
                qResult.rows[0].test_cases;


            if (
                typeof testCases ===
                "string"
            ) {

                try {

                    testCases =
                        JSON.parse(
                            testCases
                        );

                } catch (err) {

                    return res.json({
                        success: false,
                        results: [],
                        error: "Invalid test case JSON."
                    });

                }

            }


            if (
                !Array.isArray(testCases)
            ) {

                testCases = [];

            }


            const resultsSummary = [];


            for (
                const test of testCases
            ) {

                const output =
                    await new Promise(
                        (resolve) => {

                            executeCode(
                                code,
                                language,
                                test.input,
                                (
                                    err,
                                    out
                                ) => {

                                    resolve(
                                        out !== null &&
                                        out !== undefined
                                            ? out
                                            : err ||
                                              ""
                                    );

                                }
                            );

                        }
                    );


                const actualOutput =
                    output
                        .toString()
                        .trim();


                const expectedOutput =
                    String(
                        test.output ??
                        ""
                    )
                    .trim();


                const isPassed =
                    actualOutput ===
                    expectedOutput;


                resultsSummary.push({

                    passed:
                        isPassed,

                    output:
                        actualOutput,

                    expected:
                        expectedOutput

                });

            }


            res.json({

                success: true,

                results:
                    resultsSummary

            });


        } catch (err) {

            console.error(
                "RUN CODE ERROR:",
                err
            );

            res.status(500).json({

                success: false,

                results: [],

                error:
                    "Server Error"

            });

        }

    }
);


// ============================================================
// GET SUBMITTED QUESTION IDS FOR A STUDENT
// ============================================================

app.get(
    "/user-submissions/:id",
    async (req, res) => {

        const username =
            req.params.id;


        try {

            const result =
                await pool.query(
                    `
                    SELECT question_id
                    FROM submissions
                    WHERE username = $1
                    ORDER BY question_id ASC
                    `,
                    [username]
                );


            const submittedQuestions =
                result.rows.map(
                    r => r.question_id
                );


            res.json({

                success: true,

                submittedQuestions

            });


        } catch (err) {

            console.error(
                "USER SUBMISSIONS ERROR:",
                err
            );

            res.status(500).json({

                success: false,

                submittedQuestions: []

            });

        }

    }
);


// ============================================================
// STUDENT DASHBOARD
// ============================================================

app.get(
    "/student-dashboard/:id",
    async (req, res) => {

        const studentId =
            req.params.id;


        if (!studentId) {

            return res.status(400).json({

                success: false,

                message:
                    "Student ID is required."

            });

        }


        try {

            // ------------------------------------------------
            // 1. STUDENT PROFILE
            // ------------------------------------------------

            const studentResult =
                await pool.query(
                    `
                    SELECT
                        student_id,
                        student_name,
                        student_course,
                        phone,
                        email
                    FROM students
                    WHERE student_id = $1
                    `,
                    [studentId]
                );


            if (
                studentResult.rows.length === 0
            ) {

                return res.status(404).json({

                    success: false,

                    message:
                        "Student not found."

                });

            }


            const student =
                studentResult.rows[0];


            // ------------------------------------------------
            // 2. TOTAL QUESTIONS
            // ------------------------------------------------

            const questionResult =
                await pool.query(
                    `
                    SELECT COUNT(*) AS total
                    FROM questions
                    `
                );


            const totalQuestions =
                Number(
                    questionResult.rows[0].total
                ) || 0;


            // ------------------------------------------------
            // 3. STUDENT RESULT
            // ------------------------------------------------

            const resultResult =
                await pool.query(
                    `
                    SELECT
                        username,
                        score,
                        time_taken,
                        attempts,
                        created_at,
                        submitted_at
                    FROM results
                    WHERE username = $1
                    `,
                    [studentId]
                );


            const result =
                resultResult.rows.length > 0
                    ? resultResult.rows[0]
                    : null;


            // ------------------------------------------------
            // 4. STUDENT SUBMISSIONS
            // ------------------------------------------------

            const submissionResult =
                await pool.query(
                    `
                    SELECT
                        question_id,
                        language,
                        score,
                        time_taken,
                        submitted_at
                    FROM submissions
                    WHERE username = $1
                    ORDER BY submitted_at DESC
                    `,
                    [studentId]
                );


            const submissions =
                submissionResult.rows;


            // ------------------------------------------------
            // 5. RESPONSE
            // ------------------------------------------------

            res.json({

                success: true,

                student: {

                    student_id:
                        student.student_id,

                    student_name:
                        student.student_name,

                    student_course:
                        student.student_course,

                    phone:
                        student.phone,

                    email:
                        student.email

                },

                result,

                totalQuestions,

                submissions

            });


        } catch (err) {

            console.error(
                "❌ Student Dashboard Error:",
                err
            );


            res.status(500).json({

                success: false,

                message:
                    "Unable to load student dashboard.",

                error:
                    err.message

            });

        }

    }
);


// ============================================================
// SUBMIT CODE
// ============================================================
// Saves latest submission for each student/question.
// Score = 5 marks per passed test case.
// ============================================================

app.post(
    "/submit",
    async (req, res) => {

        const {
            code,
            language,
            questionId,
            username,
            timeSpent
        } = req.body;


        // ----------------------------------------------------
        // VALIDATION
        // ----------------------------------------------------

        if (!username) {

            return res.status(400).json({

                success: false,

                error:
                    "Student ID missing"

            });

        }


        if (!questionId) {

            return res.status(400).json({

                success: false,

                error:
                    "Question ID missing"

            });

        }


        if (!code) {

            return res.status(400).json({

                success: false,

                error:
                    "Code is empty"

            });

        }


        const client =
            await pool.connect();


        try {

            await client.query(
                "BEGIN"
            );


            // ------------------------------------------------
            // 1. CHECK STUDENT
            // ------------------------------------------------

            const studentResult =
                await client.query(
                    `
                    SELECT student_id
                    FROM students
                    WHERE student_id = $1
                    `,
                    [username]
                );


            if (
                studentResult.rows.length === 0
            ) {

                throw new Error(
                    "Student not found: " +
                    username
                );

            }


            // ------------------------------------------------
            // 2. GET QUESTION
            // ------------------------------------------------

            const qResult =
                await client.query(
                    `
                    SELECT test_cases
                    FROM questions
                    WHERE id = $1
                    `,
                    [questionId]
                );


            if (
                qResult.rows.length === 0
            ) {

                throw new Error(
                    "Question not found: " +
                    questionId
                );

            }


            let testCases =
                qResult.rows[0].test_cases;


            if (
                typeof testCases ===
                "string"
            ) {

                testCases =
                    JSON.parse(
                        testCases
                    );

            }


            if (
                !Array.isArray(testCases)
            ) {

                testCases = [];

            }


            // ------------------------------------------------
            // 3. RUN TEST CASES
            // ------------------------------------------------

            let passedCount = 0;


            for (
                const test of testCases
            ) {

                const output =
                    await new Promise(
                        (resolve) => {

                            executeCode(
                                code,
                                language,
                                test.input,
                                (
                                    err,
                                    out
                                ) => {

                                    resolve(
                                        out ||
                                        ""
                                    );

                                }
                            );

                        }
                    );


                const actualOutput =
                    output
                        .toString()
                        .trim();


                const expectedOutput =
                    String(
                        test.output ??
                        ""
                    )
                    .trim();


                if (
                    actualOutput ===
                    expectedOutput
                ) {

                    passedCount++;

                }

            }


            // ------------------------------------------------
            // 4. SCORE
            // ------------------------------------------------

            const currentQuestionScore =
                passedCount * 5;


            let safeTime =
                parseInt(
                    timeSpent || 0,
                    10
                );


            if (
                isNaN(safeTime)
            ) {

                safeTime = 0;

            }


            safeTime =
                Math.max(
                    0,
                    safeTime
                );


            // ------------------------------------------------
            // 5. SAVE SUBMISSION
            // ------------------------------------------------

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
                (
                    $1,
                    $2,
                    $3,
                    $4,
                    $5,
                    $6,
                    CURRENT_TIMESTAMP
                )

                ON CONFLICT
                (
                    username,
                    question_id
                )

                DO UPDATE SET

                    code =
                        EXCLUDED.code,

                    language =
                        EXCLUDED.language,

                    score =
                        EXCLUDED.score,

                    time_taken =
                        EXCLUDED.time_taken,

                    submitted_at =
                        CURRENT_TIMESTAMP
            `;


            await client.query(
                submissionSql,
                [
                    username,
                    questionId,
                    code,
                    language,
                    currentQuestionScore,
                    safeTime
                ]
            );


            // ------------------------------------------------
            // 6. UPDATE OVERALL RESULT
            // ------------------------------------------------

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

                ON CONFLICT
                (
                    username
                )

                DO UPDATE SET

                    score = (
                        SELECT
                            COALESCE(
                                SUM(score),
                                0
                            )
                        FROM submissions
                        WHERE username = $1
                    ),

                    time_taken = (
                        SELECT
                            COALESCE(
                                SUM(time_taken),
                                0
                            )
                        FROM submissions
                        WHERE username = $1
                    ),

                    attempts = (
                        SELECT
                            COUNT(*)
                        FROM submissions
                        WHERE username = $1
                    ),

                    submitted_at =
                        CURRENT_TIMESTAMP
            `;


            await client.query(
                resultSql,
                [
                    username,
                    currentQuestionScore,
                    safeTime
                ]
            );


            await client.query(
                "COMMIT"
            );


            console.log(
                `✅ Submission saved: Student=${username}, Question=${questionId}, Score=${currentQuestionScore}`
            );


            res.json({

                success: true,

                scoreEarned:
                    currentQuestionScore,

                questionId:
                    questionId

            });


        } catch (err) {

            await client.query(
                "ROLLBACK"
            );


            console.error(
                "❌ SUBMIT ERROR:",
                err
            );


            res.status(500).json({

                success: false,

                error:
                    err.message

            });


        } finally {

            client.release();

        }

    }
);


// ============================================================
// ANALYTICS
// ============================================================

app.get(
    "/analytics",
    async (req, res) => {

        try {

            const query = `
                SELECT

                    r.username AS student_id,

                    s.student_name,

                    s.student_course,

                    r.attempts
                        AS total_attempts,

                    r.score
                        AS total_score,

                    r.time_taken
                        AS total_seconds,

                    r.created_at
                        AS start_time,

                    r.submitted_at
                        AS last_submitted

                FROM results r

                LEFT JOIN students s
                    ON r.username =
                       s.student_id

                ORDER BY
                    r.submitted_at DESC
            `;


            const {
                rows
            } =
                await pool.query(
                    query
                );


            res.json(
                rows
            );


        } catch (err) {

            console.error(
                "❌ Error fetching analytics:",
                err
            );


            res.status(500).json({

                success: false,

                error:
                    err.message

            });

        }

    }
);


// ============================================================
// REGISTER STUDENT
// ============================================================

app.post(
    "/register",
    async (req, res) => {

        const {
            studentId,
            studentName,
            studentCourse,
            phone,
            email,
            password
        } = req.body;


        // ----------------------------------------------------
        // VALIDATION
        // ----------------------------------------------------

        if (
            !studentId ||
            !studentName ||
            !password
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Student ID, Name, and Password are required."

            });

        }


        try {

            const query = `
                INSERT INTO students
                (
                    student_id,
                    student_name,
                    student_course,
                    phone,
                    email,
                    password
                )
                VALUES
                (
                    $1,
                    $2,
                    $3,
                    $4,
                    $5,
                    $6
                )
            `;


            const values = [

                studentId,

                studentName,

                studentCourse || null,

                phone || null,

                email || null,

                password

            ];


            await pool.query(
                query,
                values
            );


            return res.status(200).json({

                success: true,

                message:
                    "Registration successful!"

            });


        } catch (err) {

            console.error(
                "Registration error:",
                err.message
            );


            // PostgreSQL duplicate key
            if (
                err.code === "23505"
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Student ID already exists. Try logging in."

                });

            }


            return res.status(500).json({

                success: false,

                message:
                    "Internal server error during registration.",

                error:
                    err.message

            });

        }

    }
);


// ============================================================
// STUDENT LOGIN
// ============================================================

app.post(
    "/login",
    async (req, res) => {

        const {
            studentId,
            password
        } = req.body;


        if (
            !studentId ||
            !password
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Student ID and Password are required."

            });

        }


        try {

            const query = `
                SELECT *
                FROM students
                WHERE student_id = $1
            `;


            const result =
                await pool.query(
                    query,
                    [studentId]
                );


            if (
                result.rows.length === 0
            ) {

                return res.status(401).json({

                    success: false,

                    message:
                        "Authentication Error: Student ID not found."

                });

            }


            const student =
                result.rows[0];


            // ------------------------------------------------
            // CURRENT SYSTEM USES PLAIN TEXT PASSWORD
            // ------------------------------------------------
            // For production, use bcrypt.
            // ------------------------------------------------

            if (
                student.password !==
                password
            ) {

                return res.status(401).json({

                    success: false,

                    message:
                        "Authentication Error: Invalid credentials."

                });

            }


            return res.status(200).json({

                success: true,

                message:
                    "Login successful!",

                studentName:
                    student.student_name,

                studentId:
                    student.student_id

            });


        } catch (err) {

            console.error(
                "Login error:",
                err.message
            );


            return res.status(500).json({

                success: false,

                message:
                    "Internal server error during authentication."

            });

        }

    }
);


// ============================================================
// OTP STORAGE
// ============================================================
// Temporary in-memory storage.
// OTP expires after 5 minutes.
// ============================================================

const otpStorage = {};


// ============================================================
// SEND OTP
// ============================================================

app.post(
    "/send-otp",
    async (req, res) => {

        const {
            studentId,
            phone
        } = req.body;


        if (
            !studentId ||
            !phone
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Student ID and Phone Number are required."

            });

        }


        try {

            const query = `
                SELECT *
                FROM students
                WHERE student_id = $1
                AND phone = $2
            `;


            const result =
                await pool.query(
                    query,
                    [
                        studentId,
                        phone
                    ]
                );


            if (
                result.rows.length === 0
            ) {

                return res.status(404).json({

                    success: false,

                    message:
                        "No account found matching this Student ID and Phone Number."

                });

            }


            // ------------------------------------------------
            // GENERATE 6-DIGIT OTP
            // ------------------------------------------------

            const generatedOtp =
                Math.floor(
                    100000 +
                    Math.random() *
                    900000
                ).toString();


            // ------------------------------------------------
            // STORE OTP FOR 5 MINUTES
            // ------------------------------------------------

            otpStorage[studentId] = {

                otp:
                    generatedOtp,

                expiresAt:
                    Date.now() +
                    5 * 60 * 1000

            };


            // ------------------------------------------------
            // DEVELOPMENT LOG
            // ------------------------------------------------

            console.log(
                `[OTP Service] OTP for Student ID ${studentId}: ${generatedOtp}`
            );


            // ------------------------------------------------
            // NOTE:
            // Replace this with Twilio/SMS service later.
            // ------------------------------------------------

            return res.status(200).json({

                success: true,

                message:
                    "OTP generated successfully.",

                // Development/testing only.
                // Remove before production.
                debugOtp:
                    generatedOtp

            });


        } catch (err) {

            console.error(
                "Send OTP error:",
                err.message
            );


            return res.status(500).json({

                success: false,

                message:
                    "Internal server error while sending OTP."

            });

        }

    }
);


// ============================================================
// VERIFY OTP + RESET PASSWORD
// ============================================================

app.post(
    "/verify-otp",
    async (req, res) => {

        const {
            studentId,
            otp,
            newPassword
        } = req.body;


        if (
            !studentId ||
            !otp ||
            !newPassword
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Student ID, OTP and new password are required."

            });

        }


        try {

            const storedOtp =
                otpStorage[studentId];


            // ------------------------------------------------
            // OTP NOT FOUND
            // ------------------------------------------------

            if (!storedOtp) {

                return res.status(400).json({

                    success: false,

                    message:
                        "OTP not found. Please request a new OTP."

                });

            }


            // ------------------------------------------------
            // OTP EXPIRED
            // ------------------------------------------------

            if (
                Date.now() >
                storedOtp.expiresAt
            ) {

                delete otpStorage[
                    studentId
                ];


                return res.status(400).json({

                    success: false,

                    message:
                        "OTP expired. Please request a new OTP."

                });

            }


            // ------------------------------------------------
            // CHECK OTP
            // ------------------------------------------------

            if (
                storedOtp.otp !==
                otp.toString()
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Invalid OTP."

                });

            }


            // ------------------------------------------------
            // UPDATE PASSWORD
            // ------------------------------------------------

            const result =
                await pool.query(
                    `
                    UPDATE students
                    SET password = $1
                    WHERE student_id = $2
                    `,
                    [
                        newPassword,
                        studentId
                    ]
                );


            if (
                result.rowCount === 0
            ) {

                return res.status(404).json({

                    success: false,

                    message:
                        "Student not found."

                });

            }


            // ------------------------------------------------
            // DELETE USED OTP
            // ------------------------------------------------

            delete otpStorage[
                studentId
            ];


            res.json({

                success: true,

                message:
                    "Password reset successfully."

            });


        } catch (err) {

            console.error(
                "Password reset error:",
                err
            );


            res.status(500).json({

                success: false,

                message:
                    "Unable to reset password."

            });

        }

    }
);


// ============================================================
// CLEAR ALL ANALYTICS
// ============================================================

app.delete(
    "/clear-analytics",
    async (req, res) => {

        const client =
            await pool.connect();


        try {

            await client.query(
                "BEGIN"
            );


            // Delete child records first
            await client.query(
                "DELETE FROM submissions"
            );


            await client.query(
                "DELETE FROM results"
            );


            await client.query(
                "COMMIT"
            );


            res.json({

                success: true,

                message:
                    "All analytics cleared successfully"

            });


        } catch (err) {

            await client.query(
                "ROLLBACK"
            );


            console.error(
                "CLEAR ERROR:",
                err
            );


            res.status(500).json({

                success: false,

                error:
                    err.message

            });


        } finally {

            client.release();

        }

    }
);


// ============================================================
// DELETE QUESTION
// ============================================================

app.delete(
    "/delete-question/:id",
    async (req, res) => {

        const id =
            parseInt(
                req.params.id,
                10
            );


        if (isNaN(id)) {

            return res.json({

                success: false,

                error:
                    "Invalid question ID"

            });

        }


        const client =
            await pool.connect();


        try {

            await client.query(
                "BEGIN"
            );


            // ------------------------------------------------
            // Delete submissions belonging
            // to this question first.
            // ------------------------------------------------

            await client.query(
                `
                DELETE FROM submissions
                WHERE question_id = $1
                `,
                [id]
            );


            // ------------------------------------------------
            // Delete question
            // ------------------------------------------------

            const result =
                await client.query(
                    `
                    DELETE FROM questions
                    WHERE id = $1
                    `,
                    [id]
                );


            if (
                result.rowCount === 0
            ) {

                await client.query(
                    "ROLLBACK"
                );


                return res.json({

                    success: false,

                    error:
                        "Question not found"

                });

            }


            await client.query(
                "COMMIT"
            );


            res.json({

                success: true,

                message:
                    "Question deleted successfully"

            });


        } catch (err) {

            await client.query(
                "ROLLBACK"
            );


            console.error(
                "DELETE QUESTION ERROR:",
                err
            );


            res.status(500).json({

                success: false,

                error:
                    err.message

            });


        } finally {

            client.release();

        }

    }
);


// ============================================================
// HEALTH CHECK
// ============================================================

app.get(
    "/health",
    async (req, res) => {

        try {

            await pool.query(
                "SELECT 1"
            );


            res.json({

                success: true,

                status:
                    "Server and database are running."

            });


        } catch (err) {

            res.status(500).json({

                success: false,

                status:
                    "Database connection failed.",

                error:
                    err.message

            });

        }

    }
);


// ============================================================
// 404 API HANDLER
// ============================================================

app.use(
    (req, res, next) => {

        // Let static files/browser requests
        // be handled normally.

        if (
            req.path.startsWith("/api/")
        ) {

            return res.status(404).json({

                success: false,

                error:
                    "API endpoint not found."

            });

        }

        next();

    }
);


// ============================================================
// ERROR HANDLER
// ============================================================

app.use(
    (err, req, res, next) => {

        console.error(
            "❌ Unhandled Server Error:",
            err
        );


        res.status(500).json({

            success: false,

            error:
                "Internal server error."

        });

    }
);


// ============================================================
// START SERVER
// ============================================================

const PORT =
    process.env.PORT || 10000;


app.listen(
    PORT,
    () => {

        console.log(
            `🚀 Server running on port ${PORT}`
        );

    }
);