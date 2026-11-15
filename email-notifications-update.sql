ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS cancellation_email_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS cancellation_email_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_email_id text;
