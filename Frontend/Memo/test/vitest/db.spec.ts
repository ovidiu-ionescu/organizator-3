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
