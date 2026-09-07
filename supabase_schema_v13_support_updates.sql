ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS category VARCHAR(100) DEFAULT 'General';
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS assigned_agent VARCHAR(100) DEFAULT 'Unassigned';
