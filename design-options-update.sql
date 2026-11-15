-- Two full-set designs plus Polka Dots, preserving existing single-design bookings.
DO $migration$
DECLARE
  definition text;
  block_start integer;
  block_end integer;
  replacement text := $replacement$
 -- multi-full-design-v1
 designs:=case when p_full_design='none' then array[]::text[] else string_to_array(p_full_design,',') end;
 if cardinality(designs)>2 or cardinality(designs)<>(select count(distinct x) from unnest(designs) x)
   or exists(select 1 from unnest(designs) x where x not in ('french','ombre','marble','art3d','chrome','polkaDots'))
   or (not art and cardinality(designs)>0) then raise exception 'Invalid full-set design.'; end if;
 foreach design_key in array designs loop
   design_label:=case design_key when 'french' then 'French' when 'ombre' then 'Ombré' when 'marble' then 'Marble' when 'art3d' then '3D' when 'chrome' then 'Chrome' when 'polkaDots' then 'Polka Dots' end;
   price:=price+10;duration:=duration+15;
   extras:=extras||jsonb_build_array(jsonb_build_object('type','full_set_design','name',design_label));
 end loop;
$replacement$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO STRICT definition
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='create_direct_booking';
  IF position('-- multi-full-design-v1' in definition)=0 THEN
    block_start:=position('if p_full_design not in' in definition);
    block_end:=position('for k in select jsonb_object_keys(p_addons)' in definition);
    IF block_start=0 or block_end<=block_start or position('design_label text;' in definition)=0 THEN
      RAISE EXCEPTION 'Expected design validation was not found.';
    END IF;
    definition:=substring(definition from 1 for block_start-1)||replacement||substring(definition from block_end);
    definition:=replace(definition,'design_label text;','design_label text; designs text[]; design_key text;');
  END IF;
  definition:=replace(definition,
    $old$k not in ('french','glitter','marble','ombre','chrome','charms','rhinestones','art3d','simple','complex')$old$,
    $new$k not in ('french','glitter','marble','ombre','chrome','charms','rhinestones','art3d','simple','complex','polkaDots')$new$);
  definition:=replace(definition,
    $old$when 'complex' then 'Complex Nail Art' end;$old$,
    $new$when 'complex' then 'Complex Nail Art' when 'polkaDots' then 'Polka Dots' end;$new$);
  EXECUTE definition;
END
$migration$;
