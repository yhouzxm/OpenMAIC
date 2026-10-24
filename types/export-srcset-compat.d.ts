/** Native resource-pack imports this vendor's named candidate type as well as its parser. */
declare module 'parse-srcset' {
  export interface SrcsetCandidate {
    url: string;
    w?: number;
    h?: number;
    d?: number;
  }
}
