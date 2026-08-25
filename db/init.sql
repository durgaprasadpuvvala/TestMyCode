-- =========================================================
-- TEST MY CODE - COMPLETE DATABASE RESET
-- PostgreSQL / Neon
-- =========================================================

BEGIN;

-- =========================================================
-- 1. DROP OLD TABLES
-- =========================================================

DROP TABLE IF EXISTS submissions CASCADE;
DROP TABLE IF EXISTS results CASCADE;
DROP TABLE IF EXISTS questions CASCADE;
DROP TABLE IF EXISTS students CASCADE;


-- =========================================================
-- 2. STUDENTS TABLE
-- =========================================================

CREATE TABLE students (
    student_id VARCHAR(50) PRIMARY KEY,
    student_name VARCHAR(100) NOT NULL,
    student_course VARCHAR(100),
    phone VARCHAR(20),                  -- Added to support phone number field
    email VARCHAR(100),                 -- Added to support email id field
    password VARCHAR(255) DEFAULT 'adityacs',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);


-- =========================================================
-- 3. QUESTIONS TABLE
-- =========================================================

CREATE TABLE questions (
    id SERIAL PRIMARY KEY,

    title VARCHAR(255) NOT NULL UNIQUE,

    description TEXT NOT NULL,

    language VARCHAR(50) NOT NULL DEFAULT 'python',

    test_cases JSONB NOT NULL DEFAULT '[]'::jsonb,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);


-- =========================================================
-- 4. SUBMISSIONS TABLE
-- =========================================================
-- One student can submit one question again.
-- The latest submission for that question is updated.

CREATE TABLE submissions (
    id SERIAL PRIMARY KEY,

    username VARCHAR(50) NOT NULL,

    question_id INTEGER NOT NULL,

    code TEXT NOT NULL DEFAULT '',

    language VARCHAR(50) NOT NULL DEFAULT 'python',

    score INTEGER NOT NULL DEFAULT 0,

    time_taken INTEGER NOT NULL DEFAULT 0,

    submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_submission_student
        FOREIGN KEY (username)
        REFERENCES students(student_id)
        ON DELETE CASCADE,

    CONSTRAINT fk_submission_question
        FOREIGN KEY (question_id)
        REFERENCES questions(id)
        ON DELETE CASCADE,

    CONSTRAINT unique_student_question
        UNIQUE (username, question_id),

    CONSTRAINT submission_score_check
        CHECK (score >= 0),

    CONSTRAINT submission_time_check
        CHECK (time_taken >= 0)
);


-- =========================================================
-- 5. RESULTS TABLE
-- =========================================================
-- One final/current result row per student.

CREATE TABLE results (
    id SERIAL PRIMARY KEY,

    username VARCHAR(50) NOT NULL UNIQUE,

    score INTEGER NOT NULL DEFAULT 0,

    time_taken INTEGER NOT NULL DEFAULT 0,

    attempts INTEGER NOT NULL DEFAULT 0,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_result_student
        FOREIGN KEY (username)
        REFERENCES students(student_id)
        ON DELETE CASCADE,

    CONSTRAINT result_score_check
        CHECK (score >= 0),

    CONSTRAINT result_time_check
        CHECK (time_taken >= 0),

    CONSTRAINT result_attempts_check
        CHECK (attempts >= 0)
);


-- =========================================================
-- 6. INDEXES
-- =========================================================

CREATE INDEX idx_questions_created_at
ON questions(created_at);

CREATE INDEX idx_submissions_username
ON submissions(username);

CREATE INDEX idx_submissions_question_id
ON submissions(question_id);

CREATE INDEX idx_submissions_submitted_at
ON submissions(submitted_at);

CREATE INDEX idx_results_username
ON results(username);

CREATE INDEX idx_results_submitted_at
ON results(submitted_at);


-- =========================================================
-- 7. SAMPLE STUDENT
-- =========================================================

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
    '1234',
    'Durga Prasad',
    'CS-A',
    NULL,
    NULL,
    'adityacs'
);


-- =========================================================
-- 8. SAMPLE QUESTIONS
-- =========================================================

INSERT INTO questions
(
    title,
    description,
    language,
    test_cases
)
VALUES

(
    'Hello World',

    'Write a program that prints "Hello World".',

    'python',

    '[
        {
            "input": "",
            "output": "Hello World"
        }
    ]'::jsonb
),

(
    'Check Prime',

    'Write a program to check whether a number is prime.',

    'python',

    '[
        {
            "input": "7",
            "output": "True"
        },
        {
            "input": "10",
            "output": "False"
        }
    ]'::jsonb
),

(
    'Square of a Number',

    'Read an integer and print its square.',

    'python',

    '[
        {
            "input": "5",
            "output": "25"
        },
        {
            "input": "9",
            "output": "81"
        }
    ]'::jsonb
);


-- =========================================================
-- 9. VERIFY TABLES
-- =========================================================

COMMIT;


-- =========================================================
-- 10. CHECK CREATED TABLES
-- =========================================================

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;


-- =========================================================
-- 11. CHECK QUESTIONS
-- =========================================================

SELECT
    id,
    title,
    language,
    test_cases
FROM questions
ORDER BY id;


-- =========================================================
-- 12. CHECK STUDENTS
-- =========================================================

SELECT
    student_id,
    student_name,
    student_course,
    phone,
    email
FROM students
ORDER BY student_id;


-- =========================================================
-- 13. CHECK SUBMISSIONS
-- =========================================================

SELECT *
FROM submissions
ORDER BY id;


-- =========================================================
-- 14. CHECK RESULTS
-- =========================================================

SELECT *
FROM results
ORDER BY id;