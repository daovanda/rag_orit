declare const zipson: {
  parse(input: string): unknown;
  stringify(value: unknown): string;
};

export function parse(input: string): unknown;
export function stringify(value: unknown): string;

export default zipson;
