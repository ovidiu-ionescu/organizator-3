-- $1 memo_id
-- $2 title
-- $3 memotext
-- $4 savetime
-- $5 group_id
-- $6 requester_name
-- $7 file uuids
SELECT * FROM memo_write ($1, $2, $3, $4, $5, $6, $7);
