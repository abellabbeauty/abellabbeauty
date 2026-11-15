-- Extend infill choices while preserving existing bookings and service keys.
DO $migration$
DECLARE
  definition text;
  old_infill text := $old$when 'biabInfill' then label:='BIAB — Infill';price:=55;duration:=70;art:=true;$old$;
  new_infill text := $new$when 'biabInfill' then label:='BIAB — Infill (Short/Medium Length)';price:=55;duration:=70;art:=true;
 when 'biabInfillLong' then label:='BIAB — Infill (Long/Extra Long Length)';price:=60;duration:=80;art:=true;$new$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO STRICT definition
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='create_direct_booking';
  IF position('when ''biabInfillLong''' in definition)=0 THEN
    IF position(old_infill in definition)=0 THEN
      RAISE EXCEPTION 'Expected existing infill definition was not found.';
    END IF;
    definition:=replace(definition,old_infill,new_infill);
  END IF;
  definition:=replace(definition,
    $old_long$when 'biabInfillLong' then label:='BIAB — Infill (Long/Extra Long Length)';price:=60;duration:=70;art:=true;$old_long$,
    $new_long$when 'biabInfillLong' then label:='BIAB — Infill (Long/Extra Long Length)';price:=60;duration:=80;art:=true;$new_long$);
  -- Add-ons can end between quarter hours; allow the next booking at that exact minute.
  definition:=replace(definition,' or extract(minute from local_start)::integer%15<>0','');
  EXECUTE definition;
END
$migration$;
