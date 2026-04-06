INSERT INTO staff (full_name, email, position, role, is_active)
VALUES
  ('Ha Nguyen',  'ha.nguyen@studylink.org',  'CEO',          'Director', true),
  ('Rhod Joyce', 'rhod5716@gmail.com',        'Tech Support', 'Admin',    true),
  ('Lam Nguyen', 'lam.nguyen@studylink.org',  'Sales Manager','Manager',  true)
ON CONFLICT (email) DO NOTHING;