-- Add backup_emails text[] column to agencies table
ALTER TABLE public.agencies ADD COLUMN IF NOT EXISTS backup_emails text[] DEFAULT '{}';
