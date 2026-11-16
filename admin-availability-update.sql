BEGIN;
CREATE OR REPLACE FUNCTION public.admin_set_availability(p_start_at timestamptz,p_end_at timestamptz,p_type text,p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE r public.availability_overrides;
BEGIN
 IF auth.uid() IS DISTINCT FROM '4f6ebcbe-ec6f-4d78-ad3c-14ba94c503bc'::uuid THEN RAISE EXCEPTION 'Unauthorised' USING ERRCODE='42501';END IF;
 IF p_start_at IS NULL OR p_end_at IS NULL OR p_end_at<=p_start_at OR p_end_at-p_start_at>interval '25 hours' OR p_type NOT IN ('open','closed') OR p_type IS NULL THEN RAISE EXCEPTION 'Choose a valid start and finish time.';END IF;
 IF (p_start_at AT TIME ZONE 'Australia/Sydney')::date<>((p_end_at-interval '1 microsecond') AT TIME ZONE 'Australia/Sydney')::date THEN RAISE EXCEPTION 'Change one day at a time.';END IF;
 perform pg_advisory_xact_lock(hashtextextended('availability:'||(p_start_at AT TIME ZONE 'Australia/Sydney')::date::text,0));
 FOR r IN SELECT * FROM public.availability_overrides WHERE start_at<p_end_at AND end_at>p_start_at FOR UPDATE LOOP
  IF r.start_at<p_start_at AND r.end_at>p_end_at THEN
   UPDATE public.availability_overrides SET end_at=p_start_at WHERE id=r.id;
   INSERT INTO public.availability_overrides(start_at,end_at,override_type,note) VALUES(p_end_at,r.end_at,r.override_type,r.note);
  ELSIF r.start_at<p_start_at THEN
   UPDATE public.availability_overrides SET end_at=p_start_at WHERE id=r.id;
  ELSIF r.end_at>p_end_at THEN
   UPDATE public.availability_overrides SET start_at=p_end_at WHERE id=r.id;
  ELSE
   DELETE FROM public.availability_overrides WHERE id=r.id;
  END IF;
 END LOOP;
 INSERT INTO public.availability_overrides(start_at,end_at,override_type,note) VALUES(p_start_at,p_end_at,p_type,nullif(left(trim(p_note),500),''));
END
$function$;
CREATE OR REPLACE FUNCTION public.admin_set_day_hours(p_date date,p_open time DEFAULT NULL,p_close time DEFAULT NULL,p_closed boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE day_start timestamptz;day_end timestamptz;
BEGIN
 IF auth.uid() IS DISTINCT FROM '4f6ebcbe-ec6f-4d78-ad3c-14ba94c503bc'::uuid THEN RAISE EXCEPTION 'Unauthorised' USING ERRCODE='42501';END IF;
 IF p_date IS NULL OR p_closed IS NULL THEN RAISE EXCEPTION 'Choose a day.';END IF;
 IF NOT p_closed AND (p_open IS NULL OR p_close IS NULL OR p_close<=p_open) THEN RAISE EXCEPTION 'Finish time must be after start time.';END IF;
 day_start:=p_date::timestamp AT TIME ZONE 'Australia/Sydney';day_end:=(p_date+1)::timestamp AT TIME ZONE 'Australia/Sydney';
 -- Reset this day only. Neighbouring portions of multi-day records are preserved.
 perform public.admin_set_availability(day_start,day_end,'closed','Outside saved opening hours');
 IF NOT p_closed THEN
  perform public.admin_set_availability((p_date+p_open) AT TIME ZONE 'Australia/Sydney',(p_date+p_close) AT TIME ZONE 'Australia/Sydney','open','Saved opening hours');
 END IF;
END
$function$;
REVOKE ALL ON FUNCTION public.admin_set_availability(timestamptz,timestamptz,text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.admin_set_day_hours(date,time,time,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_set_availability(timestamptz,timestamptz,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_day_hours(date,time,time,boolean) TO authenticated;
COMMIT;
