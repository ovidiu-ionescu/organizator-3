import { MemoEditor } from "./memo-editor"

export interface Memo {
  id:           number;
  text:         string;
  memogroup?:   IdName;
  timestamp?:   number;
  user?:        IdName;
  readonly?:    boolean;
}

export interface IdName {
  id:           number;
  name:         string;
}

export type Requester = IdName;

export interface ServerMemo {
  id:           number;
  memogroup?:   IdName;
  user:         IdName;
  title:        string;
  memotext:     string;
  savetime?:    number;
}

export interface ServerMemoReply {
  memo:         ServerMemo;
  requester:    Requester;
}

export interface ServerMemoTitle {
  id:           number;
  group_id:     number;
  title:        string;
  userId:       number;
}

export interface ServerMemoList {
  memo:         ServerMemo;
  memos:        Array<ServerMemoTitle>;
}

export interface MemoTitle {
  id:           number;
  last_access:  number;
  title:        string;
  readonly?:    boolean;
}

export interface CacheMemo {
  id:           number;
  local:        Memo;
  server?:      Memo;
}

export interface AccessTime {
  id:           number;
  last_access:  number;
}

export interface PasswordThen {
  then: {
    // resolve: <T>(value?: T | PromiseLike<T>) => void;
    resolve: (value?: string | PromiseLike<string>) => void;
    reject: (reason?: any) => void;
  }
}

export interface GenericReject {
  (reason: any): void;
}

export interface UpdateMemoLogic {
  (
    memo:    Memo, 
    db_memo: CacheMemo, 
    resolve: (value?: Memo | PromiseLike<Memo>) => void, 
    reject:  GenericReject,
  ): CacheMemo
};

export interface HasType {
  type: string;
}

export interface GroupList {
  memogroup: IdName;
}

// Example:
// "memo_group_id":2,"memo_group_name":"Mihaela","user_group_id":1,"user_group_name":"Ionescu","user_id":1,"username":"ovidiu","access":2
export interface PermissionDetailLine {
  memo_group_id:   number;
  memo_group_name: string;
  user_group_id:   number;
  user_group_name: string;
  user_id:         number;
  username:        string;
  access:          number;
}

export interface ExplicitPermissions {
  permissions: PermissionDetailLine[];
  requester:   Requester;
}

///////////////////////////////////////////////////////////////
// filestore diagnostic, comes from the server

// Type for the objects within the db_only array
interface DbOnlyFile {
  filename:      string;
  id:            string; // It is a uuid
  memo_group_id: number | null; // permissions
  uploaded_on:   number; // Unix timestamp in milliseconds
  user_id:       number;
}

// Type for the objects within the dir_only array
interface DirOnlyFile {
  filename: string;
}

// Type for the filestore object which contains arrays of the file types
interface Filestore {
  db_only:  DbOnlyFile[];
  dir_only: DirOnlyFile[];
}

// The main type representing the entire JSON structure
export interface FileStoreDiagnostics {
  filestore: Filestore;
  requester: Requester;
}