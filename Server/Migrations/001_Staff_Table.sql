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