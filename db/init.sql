-- 1. Create Students Table
CREATE TABLE IF NOT EXISTS students (
    student_id VARCHAR(50) PRIMARY KEY,
    student_name VARCHAR(100) NOT NULL,
    student_course VARCHAR(50), -- Increased size and added here
    password VARCHAR(100) DEFAULT 'adityacs'
);

-- 2. Create Questions Table
CREATE TABLE IF NOT EXISTS questions (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) UNIQUE NOT NULL, -- Added UNIQUE for seeding safety
    description TEXT,
    language VARCHAR(50) DEFAULT 'python',
    test_cases JSONB DEFAULT '[]' 
);

-- 3. Create Results Table
CREATE TABLE IF NOT EXISTS results (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE, -- CRITICAL: Added UNIQUE for ON CONFLICT to work
    score INT DEFAULT 0,
    time_taken INT DEFAULT 0,
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_student FOREIGN KEY (username) REFERENCES students(student_id)
);

-- 4. Seed Data
INSERT INTO students (student_id, student_name, student_course, password) 
VALUES ('1234', 'Durga Prasad', 'CS-A', 'adityacs')
ON CONFLICT (student_id) DO NOTHING;

INSERT INTO questions (title, description, language, test_cases) 
VALUES 
(
    'Hello World', 
    'Write a program that prints "Hello World"', 
    'python', 
    '[{"input": "", "output": "Hello World"}, {"input": "test", "output": "Hello World"}]'::jsonb
),
(
    'Check Prime', 
    'Write a function that returns "True" if a number is prime and "False" otherwise.', 
    'python', 
    '[{"input": "7", "output": "True"}, {"input": "10", "output": "False"}]'::jsonb
),
(
    'Square of a Number', 
    'Read an integer and print its square.', 
    'python', 
    '[{"input": "5", "output": "25"}, {"input": "9", "output": "81"}]'::jsonb
)
ON CONFLICT (title) DO NOTHING;

ALTER TABLE results ADD CONSTRAINT unique_student_result UNIQUE (username);

-- This ensures the UNIQUE constraint exists so ON CONFLICT works
ALTER TABLE results ADD CONSTRAINT unique_user_submit UNIQUE (username);

-- This ensures the time_taken column exists
ALTER TABLE results ADD COLUMN IF NOT EXISTS time_taken INT DEFAULT 0;
ALTER TABLE results ADD COLUMN IF NOT EXISTS attempts INT DEFAULT 0;

-- This ensures the score column exists
ALTER TABLE results ADD COLUMN IF NOT EXISTS score INT DEFAULT 0;