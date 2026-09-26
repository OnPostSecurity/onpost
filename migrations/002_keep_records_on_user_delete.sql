-- 002: records survive officer deletion. The user_id columns become nullable
-- so the app can clear the author (SET NULL in application code) before
-- deleting a user. Shifts, reports and checkpoint photos keep their rows;
-- only a Master deleting a record removes it explicitly.
ALTER TABLE shifts ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE reports ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE checkpoints ALTER COLUMN user_id DROP NOT NULL;
