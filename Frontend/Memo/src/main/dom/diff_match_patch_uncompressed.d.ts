// we need an export at this level otherwise TypeScript complains
export declare function merge_(base: string, mine: string, remote: string): string;

// here we declare the stuff in the diff_match_patch_uncompressed.js file
declare module 'diff_match_patch_uncompressed' {
  export function merge(base: string, mine: string, remote: string): string;
}
