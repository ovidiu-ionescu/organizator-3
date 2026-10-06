-- One calendar entry, as the caller's own, in the shape list_odates.sql gives one.
--
-- $1 odate.id
-- $2 "now" in epoch milliseconds, for the `ongoing` flag — the same value list_odates.sql is
--    given, so an entry is described the same way whichever call returned it.
--
-- The caller is the id set_current_user placed in the session, not a name resolved again here.
-- db.rs has already turned the token into that id for every statement of the request; asking the
-- same question a second time is a second answer that can disagree with the first.
--
-- Read as its own statement rather than folded into create_odate.sql, for the reason
-- add_user_group_member.sql sets out: a data-modifying statement and everything around it
-- share one snapshot, so a SELECT in the statement that did the INSERT could not see the row
-- it had just added.

SELECT
  json_build_object(
    'id', odate.id,
    'start_time', odate.start_time,
    'end_time', odate.end_time,
    'ongoing', odate.start_time <= $2,
    'description', odate.description,
    'memo_text', odate.memo_text,
    'location', CASE
      WHEN location.id IS NULL THEN NULL
      ELSE json_build_object('id', location.id, 'name', location.name)
    END,
    'type', CASE
      WHEN odate_type.id IS NULL THEN NULL
      ELSE json_build_object('id', odate_type.id, 'name', odate_type.name)
    END
  )::TEXT AS json
FROM odate
LEFT JOIN location ON location.id = odate.location_id
LEFT JOIN odate_type ON odate_type.id = odate.type
WHERE odate.id = $1
  -- The ownership test, so this file is safe to call on its own.
  AND odate.user_id = (current_setting('organizator.current_user'))::INTEGER;
