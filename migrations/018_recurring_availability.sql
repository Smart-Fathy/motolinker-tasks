-- A recurring template can respect the assignees' weekly availability: when the
-- generated task would fall due on a day someone marked off, the due date moves
-- to the next day they all work. Default TRUE — a template nobody has thought
-- about should still land on a working day.
ALTER TABLE recurring_tasks ADD COLUMN IF NOT EXISTS respect_availability BOOLEAN NOT NULL DEFAULT TRUE;

-- Where a generated task's due date was moved from, so the shift is visible
-- rather than mysterious. NULL when it was not moved.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_shifted_from DATE;
