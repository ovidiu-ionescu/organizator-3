-- Verify the text search in list_odates.sql.
--
-- The endpoint's predicate is the one under test: the description and the notes are unaccented
-- and matched with the database's default full-text configuration, and the words the reader
-- typed are read with websearch_to_tsquery. This covers the three things that are easy to get
-- wrong and invisible from the outside: diacritics must not stop a match, a null in either
-- column must not drop the entry, and several words must all be present in the same entry.
--
-- Everything is inside a transaction that is rolled back, so the fixtures leave nothing behind.
BEGIN;

-- High ids and names of its own on purpose: the database this runs against is not guaranteed to
-- be empty, and a fixture that took ids 1, 2 and 3 or the name alice would collide with what is
-- there.
INSERT INTO users (id, username) VALUES (1201, 'odate_search_alice');
INSERT INTO odate (id, user_id, start_time, end_time, description, memo_text) VALUES
  -- A word in each column, so the notes are searched as well as the description.
  (2201, 1201, 1000, 2000, 'Dentist visit', 'Bring the card'),
  -- Diacritics, and no notes at all: the null must not take the entry out of every search.
  (2202, 1201, 1000, 2000, 'Ședință la birou', NULL),
  -- The second word of a two-word search.
  (2203, 1201, 1000, 2000, 'Lunch', 'with Ana');

SET LOCAL ROLE organizator_prod;
-- The session user the endpoint's transaction sets, for the same transaction.
SELECT set_current_user('odate_search_alice');

\echo
\echo '== odate text search =='
WITH searches(query_text) AS (
  VALUES ('sedinta'), ('SEDINȚĂ'), ('card'), ('lunch ana'), ('dentist ana'), (NULL)
)
SELECT
  COALESCE(searches.query_text, '(no search)') AS search,
  COALESCE(
    (
      SELECT json_agg(odate.id ORDER BY odate.id)::TEXT
      FROM odate
      WHERE odate.user_id = (current_setting('organizator.current_user'))::INTEGER
        AND odate.end_time > 0
        AND (
          searches.query_text IS NULL
          OR to_tsvector(unaccent(
               COALESCE(odate.description, '') || ' ' || COALESCE(odate.memo_text, '')
             )) @@ websearch_to_tsquery(unaccent(searches.query_text))
        )
    ),
    '[]'
  ) AS ids
FROM searches;

-- Expected, in the same order:
--   sedinta       [2202]  (unaccented: the stored word has ș and ț)
--   SEDINȚĂ       [2202]  (case and diacritics in the query as well)
--   card          [2201]  (a word only in the notes)
--   lunch ana     [2203]  (both words in the same entry)
--   dentist ana   []      (two words, but never in the same entry)
--   (no search)   [2201, 2202, 2203]
\echo

ROLLBACK;
