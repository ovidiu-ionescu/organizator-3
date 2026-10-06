-- The caller's own calendar entries that have not finished yet, soonest first.
--
-- $1 "now", in epoch milliseconds — the same unit start_time and end_time are stored in
--    (memo.savetime and location.last_used are bigint milliseconds too).
-- An entry is included while `end_time > now` rather than `start_time >= now`, so one that is
-- happening at this moment is on the list instead of vanishing the second it begins. Those
-- carry `ongoing: true` and sort to the front, since ordering by start_time puts the ones that
-- began earliest first — which is what "what am I doing" wants at the top.
--
-- The comparison is half-open, matching the range convention used for the GiST index below: an
-- entry ending exactly at now is over, and one starting exactly at now has begun.
--
-- $1 is the server's clock, not the caller's: a clock the server does not control would let a
-- wrong one hide entries.
--
-- The owner is the id set_current_user placed in the session. db.rs has already resolved the
-- token into it for every statement of the request, so an entry is filed under a real row and
-- there is no second resolution here to disagree with the first.
--
-- `node` is deliberately not read or filtered on. It held a value computed per interval so
-- that overlapping ones could be found quickly, from before Postgres had range types; that
-- job now belongs to an index on int8range(start_time, end_time) (see DDL notes for odate),
-- and `node` only costs: it sits between user_id and start_time in the old composite indexes,
-- which stops them delivering rows in start_time order and forces a sort.

WITH current_user_row AS (
  SELECT (current_setting('organizator.current_user'))::INTEGER AS user_id
)
SELECT
  json_build_object(
    'odates',
    -- COALESCE because json_agg over no rows is NULL, and a client reading a null list sees a
    -- failure rather than an empty calendar.
    COALESCE(
      (
        SELECT
          json_agg(
            json_build_object(
              'id', odate.id,
              'start_time', odate.start_time,
              'end_time', odate.end_time,
              -- Happening right now, as against still to come. The screen needs to tell them
              -- apart but has no clock of its own to do it with, and a client's clock is not
              -- the one this list was built from.
              'ongoing', odate.start_time <= $1,
              'description', odate.description,
              'memo_text', odate.memo_text,
              -- The names come along so the screen can render an entry without a second call;
              -- null when the entry has no location, which the column allows.
              'location', CASE
                WHEN location.id IS NULL THEN NULL
                ELSE json_build_object('id', location.id, 'name', location.name)
              END,
              'type', CASE
                WHEN odate_type.id IS NULL THEN NULL
                ELSE json_build_object('id', odate_type.id, 'name', odate_type.name)
              END
            )
            ORDER BY odate.start_time
          )
        FROM odate
        LEFT JOIN location ON location.id = odate.location_id
        LEFT JOIN odate_type ON odate_type.id = odate.type
        WHERE odate.user_id = (SELECT user_id FROM current_user_row)
          AND odate.end_time > $1
      ),
      '[]'::JSON
    ),
    'requester',
    json_build_object(
      'id', (SELECT user_id FROM current_user_row),
      -- Read back from the id so the response keeps the shape it had, without a parameter
      -- carrying a name the session already decides.
      'name', (
        SELECT users.username FROM users
        WHERE users.id = (SELECT user_id FROM current_user_row)
      )
    )
  )::TEXT AS json;
