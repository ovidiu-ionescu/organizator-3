# Tests

Runnable checks for the rules that live in the database: who may write a memo, which columns
they may write, and what a write reply reports. Each script builds its own fixture and rolls it
back, so a run leaves the database exactly as it found it.

They are meant for a **scratch database built from the dump**, not for production. The fixtures
insert users and groups under fixed ids, so against a database that already holds data the
inserts collide and the script errors — it will not quietly pass, but it will not be useful
either.

The reasoning behind what they check is in the `sql-access-review` skill.

## Running them

A test database runs on `localhost:5432` (`postgres` / `postgres`, database `testdb`). It starts
empty, so create the roles the dump expects and load the dump:

```bash
export PGPASSWORD=postgres
psql -h localhost -U postgres -d testdb -q -c \
  "CREATE ROLE organizator_prod LOGIN PASSWORD 'test'; CREATE ROLE auth;"
psql -h localhost -U postgres -d testdb -q -v ON_ERROR_STOP=1 \
  -f SQL/Schema/schema_dump.sql
```

The dump is the live schema, regenerated from it, so it already carries every migration that has
been applied — usually there is nothing to apply. Apply an `Updates/NNN_*.sql` only when you are
testing one that is newer than the dump. Do not apply the old ones: `001` and `002` are already
reflected in the dump, and re-running `001` fails on an `ADD COLUMN password_hash` that has
already happened.

Then run them:

```bash
for f in verify_memo_write verify_rls_shared_write verify_owner_only_columns; do
  echo "== $f"; psql -h localhost -U postgres -d testdb -q -f SQL/tests/$f.sql
done
```

## What each one covers

| script | runs as | covers |
|---|---|---|
| `verify_memo_write.sql` | superuser | the write reply's access level on every path: owner creates, owner edits, a granted member writes the body, the "nothing changed" early return, a read-only member refused, and the read path agreeing with the write reply |
| `verify_rls_shared_write.sql` | `organizator_prod` | the same writes with the policies in force: a granted member's write lands, a read-only member is refused, and the stored row and the history say what actually happened |
| `verify_owner_only_columns.sql` | `organizator_prod` | the column rule: a non-owner refused on title, group and ownership whether the write comes through `memo_write` or hits the table directly, while the body stays theirs to write |

The second and third use `SET LOCAL ROLE organizator_prod` on purpose. The dump is loaded by
`postgres`, and a superuser bypasses row level security whatever `FORCE` says, so a run as
`postgres` never exercises the policies and says nothing about production — which is how a policy
that silently blocked every shared write went unnoticed. Only `verify_memo_write.sql` runs as the
superuser, because what it checks is the function, not the policies.

Every expectation is printed beside what the run actually got, so the output can be read rather
than trusted:

```
 3. bob edits body (granted level 2) | level=2 (expect 2)
 5. carol has only level 1           | refused: SQLSTATE 2F003
 9. bob takes ownership by direct SQL | REFUSED 2F002: memo 6 belongs to user 1, so user 2 may not take it over
```
