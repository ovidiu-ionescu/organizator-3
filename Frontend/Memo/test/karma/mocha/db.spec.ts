import { Memo, ServerMemo, CacheMemo, AccessTime } from '../../../main/dom/memo_interfaces.js';

import * as db from '../../../main/dom/memo_db.js';
import { sendMessageEvent } from '../../../main/dom/events.js';

describe("Testing the database functions", () => {
  before(() => {
    return new Promise((resolve) => {
      const dbDeleteRequest = window.indexedDB.deleteDatabase(db.DBName);
      dbDeleteRequest.onsuccess = event =>  {
        resolve();
      }
    });
  });

  // save_memo_after_fetching_from_server V
  // save_memo_after_saving_to_server V
  // saveMemo (old one)
  // save_local_only V
  // delete_memo
  // unsaved_memos V
  // access_times V

  let clock: Sinon.SinonFakeTimers;
  let millis: number;

  beforeEach(() => {
    millis = (+ new Date);
    clock = sinon.useFakeTimers(millis);
  });

  afterEach(() => {
    clock.restore();
  });

  it('Should save the server memo and access time should be read time', async () => {
    await db.save_memo_after_fetching_from_server({
      memo: {        
        id:        2,
        memogroup: null,
        title:     'Title\r\n',
        memotext:  'Body',
        savetime:  100,
        user: {
          id:      1,
          name:    'root'
        },
      },
      user: {
        id:   2,
        name: 'root'
      }
    });
    clock.tick(10);
    let memo = await db.read_memo(2);
    expect(memo).to.deep.equal({
      id:        2,
      memogroup: null,
      text:      'Title\nBody',
      timestamp: 100,
      user: {
        id:      1,
        name:    'root'
      },
      readonly: true
    });

    const access_times = await db.access_times();
    expect(access_times).to.be.an('array').that.has.lengthOf(1);
    expect(access_times[0].last_access).to.equal(millis + 10);
  });

  it('should refuse to save if nothing changed', async () => {
    const saved = await db.save_local_only({
        id:         2,
        memogroup:  null,
        text:       'Title\nBody',
        timestamp:  100,
      });
    expect(saved.timestamp).to.equal(100);
  });

  it('should appear as unsaved after a save local', async () => {
    clock.tick(10);
    let saved = await db.save_local_only({
        id: 2,
        memogroup: null,
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
    clock.tick(10);
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
      user: {
        id: 1,
        name: 'root',
      }
    });
    expect(memo).to.be.deep.equal({
      id:       3,
      memogroup: {
        id:     2,
        name:   'memogroup 2'
      },
      user: {
        id:     5,
        name:   'username'
      },
      text:    'Title 3\nBody3',
      timestamp: 200,
      readonly: true
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
    const unsaved = await db.unsaved_memos();
    unsaved.map(m => m.id).forEach(id => console.log('to save: ', id));
    expect(unsaved.length).to.be.at.least(1);;
    expect(unsaved.map(m => m.id)).to.include(3);
  });

  // it('', async () => {});
});
