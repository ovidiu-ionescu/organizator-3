/*
 * https://www.chaijs.com/api/bdd/
 */
import { Memo, ServerMemo, CacheMemo, AccessTime } from '../../../main/dom/memo_interfaces.js';
import * as memo_processing from '../../../main/dom/memo_processing.js';

describe("Testing memo processing", () => {

  it("should convert a server memo to a local memo", () => {
    const server_memo = {
      memo: {
        id:        1,
        title:     'Title\r\n',
        memotext:  'body',
        memogroup: null,
        savetime:  100,
        user: {
          id: 1,
          name: "root"
        }
      },
      user: {
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

  it('should not return anythinf if clicked outside a checkbox', () => {
    const text = ' - [ ] this - [x] aha';
    expect(memo_processing.toggle_checkbox(text, 2)).to.be.equal(' - [x] this - [x] aha');

    expect(memo_processing.toggle_checkbox(text, 8)).to.be.undefined;
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

});

