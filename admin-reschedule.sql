BEGIN;
ALTER TABLE public.bookings
 ADD COLUMN IF NOT EXISTS reschedule_revision uuid,
 ADD COLUMN IF NOT EXISTS reschedule_previous_start_at timestamptz,
 ADD COLUMN IF NOT EXISTS reschedule_email_status text NOT NULL DEFAULT 'pending',
 ADD COLUMN IF NOT EXISTS reschedule_email_sent_at timestamptz,
 ADD COLUMN IF NOT EXISTS reschedule_email_id text;
CREATE OR REPLACE FUNCTION public.admin_reschedule_booking(p_booking_id uuid,p_start_at timestamptz,p_original_start_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE
  b public.bookings;
  finish timestamptz;
  blocked timestamptz;
  duration interval;
  buffer interval;
BEGIN
  IF auth.uid() IS DISTINCT FROM '4f6ebcbe-ec6f-4d78-ad3c-14ba94c503bc'::uuid THEN
    RAISE EXCEPTION 'Unauthorised' USING ERRCODE='42501';
  END IF;
  SELECT * INTO b FROM public.bookings WHERE id=p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found.';END IF;
  IF b.booking_status NOT IN ('pending','confirmed') THEN RAISE EXCEPTION 'Only active appointments can be moved.';END IF;
  IF p_start_at IS NULL OR p_original_start_at IS NULL THEN RAISE EXCEPTION 'Choose a new date and time.';END IF;
  IF b.start_at IS DISTINCT FROM p_original_start_at THEN
    IF b.start_at=p_start_at THEN RETURN to_jsonb(b);END IF;
    RAISE EXCEPTION 'This appointment has changed. Refresh the calendar before moving it.';
  END IF;
  IF b.start_at=p_start_at THEN RETURN to_jsonb(b);END IF;
  IF p_start_at<=now() OR extract(second from p_start_at)<>0 THEN RAISE EXCEPTION 'Choose a future appointment time.';END IF;
  duration:=b.end_at-b.start_at;
  buffer:=coalesce(b.blocked_until-b.end_at,interval '5 minutes');
  IF duration<=interval '0 minutes' OR buffer<interval '0 minutes' THEN RAISE EXCEPTION 'Appointment duration is invalid.';END IF;
  finish:=p_start_at+duration;blocked:=finish+buffer;
  IF (p_start_at AT TIME ZONE 'Australia/Sydney')::date<>(finish AT TIME ZONE 'Australia/Sydney')::date THEN
    RAISE EXCEPTION 'An appointment must finish on the same day.';
  END IF;
  IF NOT (SELECT coalesce(range_agg(tstzrange(a.start_at,a.end_at,'[)')) @> tstzrange(p_start_at,finish,'[)'),false)
    FROM public.get_availability_overrides(p_start_at,finish) a WHERE a.override_type='open') THEN
    RAISE EXCEPTION 'That time is outside your open hours. Open the time in Availability first.';
  END IF;
  IF EXISTS(SELECT 1 FROM public.availability_overrides a WHERE a.override_type='closed'
      AND tstzrange(a.start_at,a.end_at,'[)')&&tstzrange(p_start_at,blocked,'[)'))
    OR EXISTS(SELECT 1 FROM public.blocked_times t WHERE tstzrange(t.start_at,t.end_at,'[)')&&tstzrange(p_start_at,blocked,'[)')) THEN
    RAISE EXCEPTION 'That time is closed or blocked. Choose another time.';
  END IF;
  IF EXISTS(SELECT 1 FROM public.bookings other WHERE other.id<>b.id
    AND other.booking_status IN ('pending','confirmed')
    AND tstzrange(other.start_at,coalesce(other.blocked_until,other.end_at),'[)')&&tstzrange(p_start_at,blocked,'[)')) THEN
    RAISE EXCEPTION 'That time overlaps another appointment, including its buffer.';
  END IF;
  UPDATE public.bookings SET start_at=p_start_at,end_at=finish,blocked_until=blocked,
    reschedule_previous_start_at=b.start_at,reschedule_revision=pg_catalog.gen_random_uuid(),
    reschedule_email_status='pending',reschedule_email_sent_at=NULL,reschedule_email_id=NULL
  WHERE id=b.id RETURNING * INTO b;
  RETURN to_jsonb(b);
EXCEPTION WHEN exclusion_violation THEN
  RAISE EXCEPTION 'That time overlaps another appointment. Refresh and choose another time.';
END
$function$;
REVOKE ALL ON FUNCTION public.admin_reschedule_booking(uuid,timestamptz,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_reschedule_booking(uuid,timestamptz,timestamptz) TO authenticated;
COMMIT;
