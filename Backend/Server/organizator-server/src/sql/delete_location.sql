-- Delete one of the caller's own locations.
--
-- $1 location.id
--
-- Refused while an entry still points at it, finished or not. odate.location_id carries no
-- foreign key to location — the schema keeps only the primary keys — so nothing would stop the
-- delete and nothing would follow it: an entry left holding an id for a row that is gone comes
-- back from list_odates.sql as though it had never had a location, and nothing would have said
-- so. The count covers finished entries as well as coming ones, because a finished entry keeps
-- its location too, and a rule that counted only what the calendar happens to show would let
-- the field go on the rows nobody is looking at.
--
-- The count is over the caller's own entries: those are the only ones that can name one of the
-- caller's locations, and a count over everybody's would be a report on other people's
-- calendars.
--
-- The ownership test comes before the count in the CASE, so an id that is not the caller's
-- cannot be probed by counting what uses it.
--
-- The owner is the id set_current_user placed in the session. db.rs has already resolved the
-- token into it for every statement of the request, so there is no name to resolve again here.
--
-- The count is read by the handler to word its refusal, so it is always a number: count(*) over
-- no rows is 0, never NULL, and a NULL here would reach the client as an unexplained failure.

WITH requested AS (
  SELECT $1::INTEGER AS id
),
current_user_row AS (
  SELECT (current_setting('organizator.current_user'))::INTEGER AS user_id
),
owned_location AS (
  SELECT location.id
  FROM location
  CROSS JOIN requested
  WHERE location.id = requested.id
    AND location.user_id = (SELECT user_id FROM current_user_row)
),
used AS (
  SELECT count(*) AS used_by
  FROM odate
  CROSS JOIN requested
  WHERE odate.location_id = requested.id
    AND odate.user_id = (SELECT user_id FROM current_user_row)
),
removed AS (
  DELETE FROM location
  WHERE id IN (SELECT id FROM owned_location)
    AND (SELECT used_by FROM used) = 0
  RETURNING id
)
SELECT
  json_build_object(
    'outcome',
    CASE
      WHEN (SELECT user_id FROM current_user_row) IS NULL THEN 'no_owner'
      WHEN NOT EXISTS (SELECT 1 FROM owned_location) THEN 'no_location'
      WHEN (SELECT used_by FROM used) > 0 THEN 'in_use'
      WHEN EXISTS (SELECT 1 FROM removed) THEN 'removed'
      ELSE 'no_location'
    END,
    'used_by',
    (SELECT used_by FROM used)
  )::TEXT AS json;
