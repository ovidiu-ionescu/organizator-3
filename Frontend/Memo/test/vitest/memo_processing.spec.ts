/*
 * https://www.chaijs.com/api/bdd/
 */
import {describe, it, expect, beforeEach, afterEach, beforeAll, vi} from "vitest";
import { Memo, ServerMemo, CacheMemo, AccessTime } from '@dom/memo_interfaces.js';
import * as memo_processing from '@dom/memo_processing.js';
import konsole from "@dom/console_log.js";

const konsole_journal = () => konsole.journal();

describe("Testing memo processing", () => {

  it("should convert a server memo to a local memo", () => {
    const server_memo = {
      memo: {
        id:        1,
        title:     'Title\r\n',
        memotext:  'body',
        memogroup: undefined,
        savetime:  100,
        user: {
          id: 1,
          name: "root"
        }
      },
      requester: {
        id: 1,
        name: "root"
      }
    };

    const local_memo = memo_processing.server2local(server_memo);
    expect(local_memo.text).to.be.equal('Title\nbody')

  });

  it('should toggle a checkbox if clicked inside it', () => {
    const text = ' - [ ] this - [x] aha';
    expect(memo_processing.toggle_checkbox(text, 2)).to.be.equal(' - [x] this - [x] aha');

    expect(memo_processing.toggle_checkbox(text, 14)).to.be.equal(' - [ ] this - [ ] aha');
  });

  it('should not change anything if clicked outside a checkbox', () => {
    const text = ' - [ ] this - [x] aha';
    // null rather than the text back: the caller reads a falsy return as "nothing to do" and
    // leaves the editor untouched, so the function says it did nothing rather than handing back
    // a value that looks like an edit.
    expect(memo_processing.toggle_checkbox(text, text.indexOf('h'))).to.be.null;

    expect(memo_processing.toggle_checkbox(text, text.indexOf('a'))).to.be.null;
  });

  it('should not call a memo edited when only the line endings differ', () => {
    // What the editor wrote, against what the server keeps and hands back: the same memo, one
    // carriage return apart. The client used to hold its own form and compare it with the
    // server's, so a memo pasted with Windows line endings read as edited for ever.
    const cache_memo = {
      id: 4243,
      local: { id: 4243, text: 'Title\r\nbody' },
      server: { id: 4243, text: 'Title\nbody' },
    } as CacheMemo;
    expect(memo_processing.should_save_memo_to_server(cache_memo)).to.be.false;

    // And the blank line the server trims off the front of a memo is the same too.
    const with_blank_line = {
      id: 4244,
      local: { id: 4244, text: '\n\nTitle\nbody' },
      server: { id: 4244, text: 'Title\nbody' },
    } as CacheMemo;
    expect(memo_processing.should_save_memo_to_server(with_blank_line)).to.be.false;

    // But a real difference is still a difference.
    const edited = {
      id: 4245,
      local: { id: 4245, text: 'Title\nbody edited' },
      server: { id: 4245, text: 'Title\nbody' },
    } as CacheMemo;
    expect(memo_processing.should_save_memo_to_server(edited)).to.be.true;
  });

  it('should say which field the two halves of a record disagree about', () => {
    // A memo this device may not write cannot have been edited here, so a disagreement about it
    // is the record's doing. The line names the field so the reason is not a guess: this is how a
    // memo of the reader's own, marked read-only, was tracked down.
    const cache_memo = {
      id: 4242,
      local: { id: 4242, text: 'one\ntwo' },
      server: { id: 4242, text: 'one\nthree', readonly: true },
    } as CacheMemo;

    expect(memo_processing.should_save_memo_to_server(cache_memo)).to.be.false;

    const said = konsole_journal().join("\n");
    expect(said).to.contain("memo 4242 is dirty and readonly");
    expect(said).to.contain("chars");
    expect(said).to.contain("(differs)");
  });

  it('should pick a memo to save from local if remote does not have a timestamp', async() => {
    // no timestamp in the server memo
    const cache_memo: CacheMemo = {
      "id":1,
      "local": {
        "id":1,
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
          "id":1,
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
      expect(memo_processing.should_save_memo_to_server(cache_memo)).to.be.true;
  });

  it('should not invent a server copy for a memo it has never fetched', () => {
    const cache_memo = memo_processing.make_cache_memo({ id: 9, text: 'a memo' });

    // Nothing has looked at the server for this memo, so the record says nothing about it — and
    // a record with no server half counts as needing to be saved, which it does.
    expect(cache_memo.server).to.be.undefined;
    expect(memo_processing.should_save_memo_to_server(cache_memo)).to.be.true;
  });

  it('should keep the two halves of a synced record equal but separate', () => {
    const cache_memo = memo_processing.make_synced_cache_memo({ id: 9, text: 'a memo' });

    expect(cache_memo.local).to.deep.equal(cache_memo.server);
    expect(cache_memo.local).not.toBe(cache_memo.server);
    expect(memo_processing.should_save_memo_to_server(cache_memo)).to.be.false;

    // The point of the separation: editing the memo must not edit what the record says the
    // server holds, or the change looks already saved and is never queued.
    cache_memo.local.text = 'edited locally';
    expect(cache_memo.server?.text).to.be.equal('a memo');
    expect(memo_processing.should_save_memo_to_server(cache_memo)).to.be.true;
  });

  it('should say a memo is owned when the requester is the user it belongs to', () => {
    const memo = memo_processing.server2local({
      memo: {
        id:        7,
        title:     'Mine\r\n',
        memotext:  'body',
        savetime:  100,
        access_level: 3,
        user: { id: 5, name: 'ovidiu' },
      },
      requester: { id: 5, name: 'ovidiu' },
    });
    expect(memo.owned).to.be.true;
  });

  it('should not say a memo is owned when it belongs to somebody else', () => {
    // Access level 2 is writable, so this is the case the two questions differ on: the reader
    // may write the body and still may not move the memo to another group.
    const memo = memo_processing.server2local({
      memo: {
        id:        8,
        title:     'Shared\r\n',
        memotext:  'body',
        savetime:  100,
        access_level: 2,
        user: { id: 5, name: 'ovidiu' },
      },
      requester: { id: 6, name: 'somebody' },
    });
    expect(memo.owned).to.be.false;
    expect(memo.readonly).to.be.false;
  });

});

