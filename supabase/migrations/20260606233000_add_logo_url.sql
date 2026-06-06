-- Add logo_url text column to agencies table
ALTER TABLE public.agencies ADD COLUMN IF NOT EXISTS logo_url text;
