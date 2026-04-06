-- ============================================================
-- StudyLink Staff Management System — Database Migration
-- Run this file in Railway PostgreSQL query editor
-- ============================================================

-- 1. Create staff table
CREATE TABLE IF NOT EXISTS staff (
  id            SERIAL PRIMARY KEY,
  full_name     TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  position      TEXT NOT NULL,
  role          TEXT NOT NULL,
  password_hash TEXT,
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create student_notes table
CREATE TABLE IF NOT EXISTS student_notes (
  id          SERIAL PRIMARY KEY,
  student_id  TEXT NOT NULL,
  note_type   TEXT NOT NULL,  -- 'counselor', 'presales', 'management'
  content     TEXT NOT NULL,
  author_id   INTEGER REFERENCES staff(id),
  author_name TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS student_notes_student_id_idx 
  ON student_notes(student_id);

CREATE INDEX IF NOT EXISTS student_notes_type_idx 
  ON student_notes(note_type);

-- 3. Add assignment columns to students table
ALTER TABLE students ADD COLUMN IF NOT EXISTS counselor        TEXT DEFAULT '';
ALTER TABLE students ADD COLUMN IF NOT EXISTS senior_counselor TEXT DEFAULT '';
ALTER TABLE students ADD COLUMN IF NOT EXISTS presales         TEXT DEFAULT '';
ALTER TABLE students ADD COLUMN IF NOT EXISTS marketing_staff  TEXT DEFAULT '';

-- 4. Insert known staff members (no passwords yet — Admin will set these)
INSERT INTO staff (full_name, email, position, role, is_active)
VALUES
  ('Ha Nguyen',  'ha.nguyen@studylink.org',  'CEO',          'Director', true),
  ('Rhod Joyce', 'rhod5716@gmail.com',        'Tech Support', 'Admin',    true),
  ('Lam Nguyen', 'lam.nguyen@studylink.org',  'Sales Manager','Manager',  true)
ON CONFLICT (email) DO NOTHING;

-- ============================================================
-- Verify results
-- ============================================================
SELECT 'staff' AS table_name, COUNT(*) AS rows FROM staff
UNION ALL
SELECT 'student_notes', COUNT(*) FROM student_notes
UNION ALL
SELECT 'students (counselor column check)', COUNT(*) FROM students WHERE counselor IS NOT NULL;
