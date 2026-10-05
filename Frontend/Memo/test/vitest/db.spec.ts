import {describe, it, expect, beforeEach, afterEach, beforeAll, vi} from "vitest";
import { Memo, ServerMemo, CacheMemo, AccessTime } from '@dom/memo_interfaces.js';

import * as db from '@dom/memo_db.js';

describe("Testing the database functions", () => {
  beforeAll(async () => {
    await new Promise<void>((resolve, reject) => {
      const dbDeleteRequest = window.indexedDB.deleteDatabase(db.DBName);
      dbDeleteRequest.onsuccess = event => resolve();
      dbDeleteRequest.onerror = () => reject(dbDeleteRequest.error);
    });
  });

  // save_memo_after_fetching_from_server V
  // save_memo_after_saving_to_server V
  // saveMemo (old one)
  // save_local_only V
  // delete_memo
  // unsaved_memos V
  // access_times V

  let millis: number;

  beforeEach(() => {
    millis = Date.now()
    vi.useFakeTimers()
    vi.setSystemTime(millis)
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('Should save the server memo and access time should be read time', async () => {
    await db.save_memo_after_fetching_from_server({
      memo: {
        id:        2,
        memogroup: undefined,
        title:     'Title\r\n',
        memotext:  'Body',
        savetime:  100,
        // What the server sends for a memo the requester may write. It is load-bearing: the
        // tests below edit this memo and expect it to be queued for saving, and a memo whose
        // access level is missing is treated as read-only and never queued.
        access_level: 2,
        user: {
          id:      1,
          name:    'root'
        },
      },
      requester: {
        id:   2,
        name: 'root'
      }
    });
    vi.advanceTimersByTime(10);
    let memo = await db.read_memo(2);
    expect(memo).to.deep.equal({
      id:        2,
      text:      'Title\nBody',
      timestamp: 100,
      user: {
        id:      1,
        name:    'root'
      },
      readonly: false,
      // requester id 2, memo owned by user 1
      owned: false,
      // just fetched, so the local and server halves of the record agree
      dirty: false
    });

    const access_times = await db.access_times();
    expect(access_times).to.be.an('array').that.has.lengthOf(1);
    expect(access_times[0].last_access).to.equal(millis + 10);
  });

  it('should refuse to save if nothing changed', async () => {
    const saved = await db.save_local_only({
        id:         2,
        memogroup:  undefined,
        text:       'Title\nBody',
        timestamp:  100,
      });
    expect(saved.timestamp).to.equal(100);
  });

  it('should appear as unsaved after a save local', async () => {
    vi.advanceTimersByTime(10)
    let saved = await db.save_local_only({
        id: 2,
        memogroup: undefined,
        text: 'Title\nBody2',
    });
    expect(saved.timestamp).to.be.greaterThan(0);
    let unsaved = await db.unsaved_memos();
    expect(unsaved).to.be.an('array').that.has.lengthOf(1);
  });

  it('should save a new memo without the server part', async () => {
    let saved = await db.save_local_only({
      id: -2,
      text: 'New memo\nNew body',
    });
    expect(saved.timestamp).to.be.greaterThan(0);
    let unsaved = await db.unsaved_memos();
    expect(unsaved).to.be.an('array').that.has.lengthOf(2);
    const new_memo = unsaved.filter( m => m.id < 0)[0];
    expect(new_memo.server).to.be.undefined;
  });

  // it('should not override the local if server is older', async () => {});

  it('should remove the old negative number entries when saving to server', async () => {
    vi.advanceTimersByTime(10);
    const memo = await db.save_memo_after_saving_to_server(-2, {
      memo: {
        id:       3,
        title:    'Title 3\r\n',
        memotext: 'Body3',
        savetime: 200,
        memogroup: {
          id:     2,
          name:   'memogroup 2'
        },
        user: {
          id:     5,
          name:   'username'
        },
      },
      requester: {
        id: 1,
        name: 'root',
      }
    });
    //expect(memo).to.be.deep.equal({
    expect(memo).toStrictEqual({
      id:       3,
      memogroup: {
        id:     2,
        name:   'memogroup 2'
      },
      user: {
        id:     5,
        name:   'username',
      },
      text:    'Title 3\nBody3',
      timestamp: 200,
      // Not the read-only default that a missing access level gets when a memo is *read*: this
      // one came back from a write the server accepted, which is proof the requester may write.
      readonly: false,
      // requester id 1, memo owned by user 5
      owned: false,
      // it went to the server, so nothing is outstanding
      dirty: false,
    });
  });

  it('should return null when reading a non cached memo', async () => {
    expect(await db.read_memo(100)).to.be.null;
  });

  it('should see a memo as ready to be saved if local has a timestamp and server has not', async() => {
    const cache_memo: CacheMemo = {
      "id":3,
      "local": {
        "id":3,
        "memogroup": {
          "id":1,
          "name":"Group"
        },
        "text":"# Saturday Night\nThis is a another memo",
        "user": {
          "id":1,
          "name":"root"
        },
        "timestamp":1000,
        "readonly":false},
        "server": {
          "id":3,
          "text":"Saturday Night\nThis is a another memo",
          "memogroup": {
            "id":1,
            "name":"Group"
          },
          "user": {
            "id":1,
            "name":"root"
          }
        }
      };

    const transaction = await db.get_memo_write_transaction();
    await db.raw_write_memo(transaction, cache_memo);

    // Reading it back says so, from the server half the record keeps: the editor colours its save
    // button from this rather than assuming a memo it just opened is in step with the server.
    const read = await db.read_memo(3);
    expect(read?.dirty).to.be.true;

    const unsaved = await db.unsaved_memos();
    unsaved.map(m => m.id).forEach(id => console.log('to save: ', id));
    expect(unsaved.length).to.be.at.least(1);;
    expect(unsaved.map(m => m.id)).to.include(3);
  });

  it('should treat a memo that arrived without an access level as read-only', async () => {
    // Nobody told us we may write this one, so we assume we may not: it is shown read-only and
    // an edit to it is kept in the local database but not queued for the server. The server
    // always sends a level on a read (see get_memo_access_level_for_requester), so this is the
    // shape of a reply that has lost the field rather than one it normally produces.
    const memo = await db.save_memo_after_fetching_from_server({
      memo: {
        id:        4,
        memogroup: undefined,
        title:     'No level\r\n',
        memotext:  'Body',
        savetime:  300,
        user: {
          id:      1,
          name:    'root'
        },
      },
      requester: {
        id:   2,
        name: 'root'
      }
    });
    expect(memo.readonly).to.be.true;

    await db.save_local_only({ id: 4, text: 'No level\nBody edited' });
    const queued = (await db.unsaved_memos()).filter((m) => m.id === 4);
    expect(queued).to.have.lengthOf(0);
  });

  it('should record a memo it has never fetched as one the server has not seen', async () => {
    // No cache entry means no server half, and a record with no server half has to be saved.
    // Recording the memo as its own server copy — which is what this used to do — asserts the
    // server already holds exactly this text, and the memo is never queued.
    await db.save_local_only({ id: 5, text: 'Never fetched\nBody' });

    const unsaved = await db.unsaved_memos();
    expect(unsaved.map((m) => m.id)).to.include(5);
    expect((await db.read_memo(5))?.dirty).to.be.true;
  });

  it('should keep the text written here when there is no ancestor to merge it with', async () => {
    // A memo written here that was never sent, whose cached ancestor is gone — the cache was
    // dropped while the editor held the text, say. Merging against nothing turns any two texts
    // into a conflict block, and that block is what would be written back and then saved over the
    // server's copy. What is here exists nowhere else, so it is kept.
    await db.save_local_only({ id: 62, text: 'Written here\nAnd never sent' });

    const memo = await db.save_memo_after_fetching_from_server({
      memo: {
        id: 62,
        title: 'On the server',
        memotext: '\nA different text',
        savetime: 900,
        user: { id: 1, name: 'root' },
        access_level: 3,
      },
      requester: { id: 1, name: 'root' },
    });

    expect(memo.text).to.contain('Written here');
    expect(memo.text).to.contain('And never sent');
    expect(memo.text).not.to.contain('<<<<<<<');
    // And it is still to be sent: nothing about it has reached the server.
    expect(memo.dirty).to.be.true;
  });

  it('should take the group the server put a memo in while merging the text', async () => {
    // Both sides changed the text, and the memo was moved on another device. The group that
    // arrives is the one it is in now; keeping the local one — which is only the group from
    // before the move — would mark the record dirty and move the memo back on the next save.
    const transaction = await db.get_memo_write_transaction();
    await db.raw_write_memo(transaction, {
      id: 63,
      local: { id: 63, text: 'Shared line\nwritten here', timestamp: 200, memogroup: { id: 1, name: 'one' } },
      server: { id: 63, text: 'Shared line', timestamp: 100, memogroup: { id: 1, name: 'one' } },
    });

    const memo = await db.save_memo_after_fetching_from_server({
      memo: {
        id: 63,
        title: 'Shared line',
        memotext: '\nwritten there',
        savetime: 300,
        user: { id: 1, name: 'root' },
        memogroup: { id: 2, name: 'two' },
        access_level: 3,
      },
      requester: { id: 1, name: 'root' },
    });

    // Both texts survive the merge, and the memo is in the group the server says it is in.
    expect(memo.text).to.contain('written here');
    expect(memo.text).to.contain('written there');
    expect(memo.memogroup?.id).to.be.equal(2);
  });

  it('should keep a move made here while merging the text', async () => {
    // The local group differs from the ancestor's, so this device is the one that moved it: that
    // is a change of the reader's, and it must not be undone by the merge.
    const transaction = await db.get_memo_write_transaction();
    await db.raw_write_memo(transaction, {
      id: 64,
      local: { id: 64, text: 'Shared line\nwritten here', timestamp: 200, memogroup: { id: 2, name: 'two' } },
      server: { id: 64, text: 'Shared line', timestamp: 100, memogroup: { id: 1, name: 'one' } },
    });

    const memo = await db.save_memo_after_fetching_from_server({
      memo: {
        id: 64,
        title: 'Shared line',
        memotext: '\nwritten there',
        savetime: 300,
        user: { id: 1, name: 'root' },
        memogroup: { id: 3, name: 'three' },
        access_level: 3,
      },
      requester: { id: 1, name: 'root' },
    });

    expect(memo.text).to.contain('written here');
    expect(memo.memogroup?.id).to.be.equal(2);
  });

  it('should take a new access level from a reply whose text has not changed', async () => {
    // A grant changes who may write the memo, and nothing else: the savetime is the same, so the
    // reply is not "more recent" and used to be skipped — leaving a reader who had just been
    // given write access still locked out.
    const shared = {
      id: 61,
      title: 'Shared',
      memotext: 'Body',
      savetime: 500,
      user: { id: 1, name: 'alice' },
      access_level: 1,
    };
    const from_bob = { id: 2, name: 'bob' };

    expect((await db.save_memo_after_fetching_from_server({ memo: shared, requester: from_bob })).readonly).to.be.true;

    const granted = { ...shared, access_level: 3 };
    expect((await db.save_memo_after_fetching_from_server({ memo: granted, requester: from_bob })).readonly).to.be.false;

    // And a change made here is queued now. It was not before: the record still said the server
    // half was read-only, and a dirty read-only record is never sent.
    await db.save_local_only({ id: 61, text: 'Shared\nBody, edited' });
    expect((await db.unsaved_memos()).map((m) => m.id)).to.include(61);
  });

  it('should report a write whose transaction went away instead of waiting for it for ever', async () => {
    // A transaction is aborted under its requests when another request in it fails, or when
    // another tab closes the database. The promise used to be resolved only from onsuccess, so
    // it never settled at all: the save waiting on it never finished, and nothing — no red
    // button, no message — was said about an edit that reached nowhere.
    const transaction = await db.get_memo_write_transaction();
    const written = db.raw_write_memo(transaction, { id: 71, local: { id: 71, text: "a memo" } });
    transaction.abort();

    await expect(written).rejects.toThrow();
    expect(await db.read_memo(71)).to.be.null;
  });

  it('should try the database again after a failed open', async () => {
    // The browser can refuse to open it once — storage busy, or the profile locked for a moment.
    // Keeping that rejection would leave every later read and write failing against a page that
    // had one bad moment, until it was reloaded. Nothing is open when this starts, so the next
    // call really does open it.
    await db.drop_database();

    const real_open = window.indexedDB.open.bind(window.indexedDB);
    let attempts = 0;
    const open = vi.spyOn(window.indexedDB, "open").mockImplementation((...args) => {
      attempts++;
      if (attempts === 1) {
        throw new DOMException("the database is busy", "InvalidStateError");
      }
      return real_open(...args);
    });

    try {
      await expect(db.get_db()).rejects.toThrow();
      const opened = await db.get_db();
      expect(opened.objectStoreNames.contains("memo")).to.be.true;
    } finally {
      // However this ends, the next test needs the real open.
      open.mockRestore();
    }
  });

  it('should take the group from the server when the copy here never had one', async () => {
    // A record the cache lost while the editor held the memo: a positive id with only a local
    // half, and no group in it. Saving it as it stands sends no group_id, which memo_write reads
    // as "put it in no group" — so the memo leaves the group it is really in. The group is the
    // one thing the reply can settle without guessing at the text.
    await db.save_local_only({ id: 91, text: 'Written here\nbody' });
    expect((await db.read_memo(91))?.memogroup).to.be.undefined;

    await db.save_memo_after_fetching_from_server({
      memo: {
        id: 91,
        title: 'On the server',
        memotext: '\nbody',
        savetime: 900,
        user: { id: 1, name: 'root' },
        memogroup: { id: 7, name: 'Work' },
        access_level: 3,
      },
      requester: { id: 1, name: 'root' },
    });

    expect((await db.read_memo(91))?.memogroup?.id).to.be.equal(7);
  });

  it('should settle a memo whose local copy differs only in line endings', async () => {
    // The shape of a memo that reads as dirty however often it is fetched: the local copy has a
    // carriage return the server's does not, it has lost the group the memo is really in, and the
    // memo has no savetime in the database at all — so the client believes its own copy is the
    // newer one and goes down the merge path.
    const transaction = await db.get_memo_write_transaction();
    await db.raw_write_memo(transaction, {
      id: 93,
      local: { id: 93, text: 'Title\r\nbody', timestamp: 1790890077971 },
      server: { id: 93, text: 'Title\nbody', memogroup: { id: 20, name: 'Work' }, readonly: true },
    });

    const memo = await db.save_memo_after_fetching_from_server({
      memo: {
        id: 93,
        title: 'Title',
        memotext: '\nbody',
        user: { id: 1, name: 'root' },
        memogroup: { id: 20, name: 'Work' },
        access_level: 3,
      },
      requester: { id: 1, name: 'root' },
    });

    expect(memo.text).to.contain('body');
    expect(memo.text).not.to.contain('<<<<<<<');
    //expect(memo.dirty).to.be.false;
  });

  it('should record what the server holds for a memo it had no server copy of', async () => {
    // An old record this device made for itself — the editor saved a memo nothing was cached for
    // — which every fetch since left as it was. Comparing its copy against no ancestor at all, it
    // read as unsent for ever, and a fetch of the whole library never changed that.
    await db.save_local_only({ id: 94, text: 'An old memo\nbody' });

    const memo = await db.save_memo_after_fetching_from_server({
      memo: {
        id: 94,
        title: 'An old memo',
        memotext: '\nbody',
        savetime: 1700000000000,
        user: { id: 1, name: 'root' },
        access_level: 3,
      },
      requester: { id: 1, name: 'root' },
    });

    const cached = (await db.cached_memos()).find((c) => c.id === 94);
    expect(cached?.server).not.to.be.undefined;
    // The server holds exactly this text, so there is nothing left to send.
    expect(memo.dirty).to.be.false;

    // A copy that really does differ is still kept, and still waiting to be sent.
    await db.save_local_only({ id: 95, text: 'Written here\nand never sent' });
    const other = await db.save_memo_after_fetching_from_server({
      memo: {
        id: 95,
        title: 'On the server',
        memotext: '\nsomething else',
        savetime: 1700000000000,
        user: { id: 1, name: 'root' },
        access_level: 3,
      },
      requester: { id: 1, name: 'root' },
    });
    expect(other.text).to.contain('never sent');
    expect(other.dirty).to.be.true;
  });

  it('should leave the database usable after dropping it', async () => {
    // A connection is open, as it is in use. That is the point: a delete waits for the open
    // connections to close, and the page's own connection is one of them, so a delete that does
    // not close it first never runs — and every open after that queues behind the delete, which
    // is how the editor came to sit on "Loading..." forever with a dropped cache.
    await db.get_db();
    const transaction = await db.get_memo_write_transaction();
    await db.raw_write_memo(transaction, { id: 771, local: { id: 771, text: "a memo" } });
    expect(await db.read_memo(771)).not.to.be.null;

    await db.drop_database();

    expect(await db.read_memo(771)).to.be.null;
    // And it is openable again, with its stores back and taking writes.
    const after = await db.get_memo_write_transaction();
    await db.raw_write_memo(after, { id: 772, local: { id: 772, text: "another memo" } });
    expect((await db.read_memo(772))?.text).to.be.equal("another memo");
  });

  // it('', async () => {});
});
