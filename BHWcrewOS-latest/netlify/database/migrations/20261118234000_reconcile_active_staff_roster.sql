-- Reconcile the active CrewOS roster confirmed by the practice owner.
DO $$
DECLARE
  retained_ids constant text[] := ARRAY['39358075-8d30-81a2-9d5a-d2fbca3cf4b5',
    '39358075-8d30-81a2-a2a0-d41f713af0a1',
    '3e458075-8d30-801f-9777-ecea4591380a',
    '39358075-8d30-8125-93b0-d54f9e1fb69b',
    '39358075-8d30-8137-a427-e45aa4ddf49e'];
  amari_ids text[];
  amari_id text;
BEGIN
  LOCK TABLE crewos_operational_records IN SHARE ROW EXCLUSIVE MODE;

  -- Deploy previews can have an empty database.
  IF NOT EXISTS (SELECT 1 FROM crewos_operational_records WHERE namespace = 'staff') THEN
    RETURN;
  END IF;

  IF (SELECT count(*) FROM crewos_operational_records
      WHERE namespace = 'staff'
        AND record_id = ANY(retained_ids)
        AND payload #>> '{properties,Active,checkbox}' = 'true') <> 5 THEN
    RAISE EXCEPTION 'Expected active staff records are missing. Review the roster before proceeding.';
  END IF;

  SELECT array_agg(record_id)
    INTO amari_ids
    FROM crewos_operational_records
    WHERE namespace = 'staff'
      AND lower(trim(COALESCE(payload #>> '{properties,Name,title,0,plain_text}',
                               payload #>> '{properties,Name,title,0,text,content}'))) = 'amari murray-fishback';

  IF COALESCE(cardinality(amari_ids), 0) > 1 THEN
    RAISE EXCEPTION 'Multiple Amari Murray-Fishback accounts found. Review the roster before proceeding.';
  END IF;

  amari_id := amari_ids[1];
  IF amari_id = ANY(retained_ids) THEN
    RAISE EXCEPTION 'Amari must have a separate staff record.';
  END IF;

  IF amari_id IS NULL THEN
    amari_id := 'crew-d4d1e49d-dfa5-4ad9-a182-118afc934d13';
    INSERT INTO crewos_operational_records (namespace, record_id, payload)
    VALUES ('staff', amari_id, jsonb_build_object('id', amari_id, 'properties', '{
      "Name": {"title": [{"plain_text": "Amari Murray-Fishback"}]},
      "Role": {"select": {"name": "Documentation Assistant"}},
      "Divisions": {"multi_select": [{"name": "Primary Care"}]},
      "Landing Page": {"select": {"name": "Primary Care"}},
      "Access Level": {"select": {"name": "Division"}},
      "Can Schedule": {"checkbox": false},
      "Active": {"checkbox": true},
      "PIN Hash": {"rich_text": []}
    }'::jsonb));
  ELSE
    UPDATE crewos_operational_records
    SET payload = jsonb_set(payload, '{properties,Active}', '{"checkbox":true}'::jsonb),
        version = version + 1,
        updated_at = now()
    WHERE namespace = 'staff' AND record_id = amari_id
      AND payload #>> '{properties,Active,checkbox}' IS DISTINCT FROM 'true';
  END IF;

  UPDATE crewos_operational_records
  SET payload = jsonb_set(payload, '{properties,Active,checkbox}', 'false'::jsonb),
      version = version + 1,
      updated_at = now()
  WHERE namespace = 'staff'
    AND payload #>> '{properties,Active,checkbox}' = 'true'
    AND record_id <> ALL(array_append(retained_ids, amari_id));

  IF (SELECT count(*) FROM crewos_operational_records
      WHERE namespace = 'staff' AND payload #>> '{properties,Active,checkbox}' = 'true') <> 6 THEN
    RAISE EXCEPTION 'Roster verification did not find exactly six active staff records.';
  END IF;
END $$;
