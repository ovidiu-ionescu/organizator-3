select id, title, user_id, savetime
  from memo
 where to_tsvector(unaccent(title || memotext)) @@ to_tsquery(unaccent($1))

