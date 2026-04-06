CREATE INDEX IF NOT EXISTS student_notes_student_id_idx ON student_notes(student_id);
CREATE INDEX IF NOT EXISTS student_notes_type_idx ON student_notes(note_type);

// Validate indices generated
//SELECT indexname FROM pg_indexes WHERE tablename = 'student_notes';