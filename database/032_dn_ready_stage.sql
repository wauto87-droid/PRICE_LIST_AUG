WITH eligible AS (
 SELECT n.id,n.stage,r.created_by
 FROM dn_notes n
 JOIN dn_reports r ON r.id=n.report_id
 JOIN dn_entries e ON e.snapshot_id=r.current_snapshot AND e.identity_key=n.identity_key
 WHERE n.stage='REVIEW'
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(e.lines) l WHERE (l->>'balance')::numeric>=1)
   AND NOT EXISTS (SELECT 1 FROM dn_events h WHERE h.note_id=n.id AND h.kind='MOVE')
), changed AS (
 UPDATE dn_notes n SET stage='READY',version=version+1,updated_at=now()
 FROM eligible x WHERE n.id=x.id RETURNING n.id,x.created_by
)
INSERT INTO dn_events(id,note_id,actor_id,kind,content,before_value,after_value)
SELECT (substr(md5(id::text||':ready-stage'),1,8)||'-'||substr(md5(id::text||':ready-stage'),9,4)||'-4'||substr(md5(id::text||':ready-stage'),14,3)||'-a'||substr(md5(id::text||':ready-stage'),18,3)||'-'||substr(md5(id::text||':ready-stage'),21,12))::uuid,
 id,created_by,'AUTO_STAGE','Ready to bill: imported line balance is 1 or above','{"stage":"REVIEW"}'::jsonb,'{"stage":"READY","rule":"LINE_BALANCE_GTE_1"}'::jsonb
FROM changed;
