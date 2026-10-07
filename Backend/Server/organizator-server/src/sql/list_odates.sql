-- The caller's own calendar entries, soonest first.
--
-- $1 "now", in epoch milliseconds — the same unit start_time and end_time are stored in
--    (memo.savetime and location.last_used are bigint milliseconds too). It is the server's
--    clock, not the caller's: a clock the server does not control would let a wrong one decide
--    what is happening.
-- $2 "from", in epoch milliseconds. The handler passes the server's now when the caller asked
--    for no particular range, which is what makes the default reading "everything coming up".
-- $3 "until", in epoch milliseconds, or NULL for no end.
--
-- An entry is in the list when its own interval overlaps [$2, $3): one is included while
-- `end_time > from` rather than `start_time >= from`, so one happening at this moment is on the
-- list instead of vanishing the second it begins. `until` is exclusive for the same reason from
-- the other side — an entry starting exactly at until is outside the range — so the two are the
-- half-open convention the range index below uses, and a range covering a whole day takes
-- midnight to midnight.
--
-- With the handler passing now for `from` and nothing for `until`, that reduces to the list the
-- screen shows by default: everything that has not finished. A caller who gives a range in the
-- past gets what happened then, which is the point of the search fields.
--
-- Those entries carry `ongoing: true` and sort to the front, since ordering by start_time puts
-- the ones that began earliest first — which is what "what am I doing" wants at the top. An
-- entry that has already finished is `ongoing: false` like any other yet to come, so the screen
-- tells them apart by their dates.
--
-- The owner is the id set_current_user placed in the session. db.rs has already resolved the
-- token into it for every statement of the request, so an entry is filed under a real row and
-- there is no second resolution here to disagree with the first.
--
-- The parameters are given their types in `requested`, once, and the rest of the statement reads
-- named columns. It matters more here than usual: `$3 IS NULL` says nothing about what $3 is, so
-- left to inference the comparison with the column decides it, and a bare null test somewhere
-- else could decide differently — and Postgres refuses a parameter that has been deduced as two
-- things at once.
--
-- `node` is deliberately not read or filtered on. It held a value computed per interval so
-- that overlapping ones could be found quickly, from before Postgres had range types; that
-- job now belongs to an index on int8range(start_time, end_time) (see DDL notes for odate),
-- and `node` only costs: it sits between user_id and start_time in the old composite indexes,
-- which stops them delivering rows in start_time order and forces a sort.

WITH requested AS (
  SELECT
    $1::BIGINT AS now_ms,
    $2::BIGINT AS from_time,
    $3::BIGINT AS until_time
),
current_user_row AS (
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
              -- Happening right now, as against still to come or already over. The screen needs
              -- to tell them apart but has no clock to do it with, and a client's clock is not
              -- the one this list was built from.
              'ongoing', odate.start_time <= (SELECT now_ms FROM requested)
                AND odate.end_time > (SELECT now_ms FROM requested),
              'description', odate.description,
              'memo_text', odate.memo_text,
              -- The names come along so the screen can render an entry without a second call;
              -- null when the entry has no location, which the column allows.
              --
              -- The point travels with the name, so the screen can offer a map of where the
              -- entry is without asking for the location again. Both are null for a location
              -- nobody has put on the earth, which is the ordinary state of one.
              'location', CASE
                WHEN location.id IS NULL THEN NULL
                ELSE json_build_object(
                  'id', location.id,
                  'name', location.name,
                  'latitude', location.latitude,
                  'longitude', location.longitude
                )
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
        CROSS JOIN requested
        WHERE odate.user_id = (SELECT user_id FROM current_user_row)
          -- The overlap test, written as the two half-open comparisons it is: the entry ends
          -- after the range begins, and begins before the range ends.
          AND odate.end_time > requested.from_time
          AND (requested.until_time IS NULL OR odate.start_time < requested.until_time)
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
