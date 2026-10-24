/** Minimal vendor surfaces used by the native export engines; no runtime change. */
declare module 'parse-srcset' {
  export default function parseSrcset(
    input: string,
  ): { url: string; w?: number; h?: number; d?: number }[];
}
declare module 'svg-arc-to-cubic-bezier' {
  export default function arcToBezier(input: {
    px: number;
    py: number;
    cx: number;
    cy: number;
    rx: number;
    ry: number;
    xAxisRotation: number;
    largeArcFlag: number;
    sweepFlag: number;
  }): { x: number; y: number; x1: number; y1: number; x2: number; y2: number }[];
}
