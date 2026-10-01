select id, title, user_id, savetime
  from memo
 where to_tsvector(unaccent(title || memotext)) @@ websearch_to_tsquery(unaccent($1))
-- websearch_to_tsquery, not to_tsquery: what arrives here is whatever the reader typed in a search
-- box, and to_tsquery reads that as query syntax rather than as words. "invoice march" — two
-- ordinary words — is a syntax error to it (42601), which the caller saw as a 500. The websearch
-- form takes plain words, quoted phrases and a leading minus, and cannot be malformed.

