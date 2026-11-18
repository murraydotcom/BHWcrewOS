-- Apply the owner's later staffing update to the October export recovery.
-- Scope this change to the recovered account before any subsequent staff edits.
UPDATE crewos_operational_records
SET payload = jsonb_set(payload, '{properties,Active,checkbox}', 'false'::jsonb),
    version = version + 1,
    updated_at = NOW()
WHERE namespace = 'staff'
  AND record_id = '3e258075-8d30-8065-abf4-f29f076bda93'
  AND version = 1
  AND payload #>> '{properties,Name,title,0,plain_text}' = 'Taylor Allen'
  AND payload #>> '{properties,Active,checkbox}' = 'true'
  AND EXISTS (
    SELECT 1 FROM crewos_cutover_state
    WHERE state_key = 'staff-export-recovery'
      AND mode = 'database'
      AND finalized_by = 'staff-export:2026-10-08:abcf4c9b405397170b8acb1b45de1d0f9cbc3e9ae351bd31a0fb7fc0d9b8dcc9'
  );
