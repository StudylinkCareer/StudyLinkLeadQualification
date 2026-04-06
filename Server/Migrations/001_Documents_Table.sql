CREATE TABLE IF NOT EXISTS student_notes (
  id          SERIAL PRIMARY KEY,
  student_id  TEXT NOT NULL,
  note_type   TEXT NOT NULL,
  content     TEXT NOT NULL,
  author_id   INTEGER REFERENCES staff(id),
  author_name TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);