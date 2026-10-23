// Minimal types for aurora-field (the package ships plain JS). Only what KIN uses.
declare module 'aurora-field' {
  export interface Field {
    setShape(name: string, opts?: { pin?: boolean | number }): void;
    set(opts: Record<string, unknown>): void;
    signal?(at?: unknown, strength?: number, spread?: number): void;
    on(ev: string, fn: (...a: unknown[]) => void): void;
    pause(): void;
    play(): void;
    resize(): void;
    destroy(): void;
  }
  export function create(canvas: HTMLCanvasElement, opts?: Record<string, unknown>): Field;
  export function register(name: string, build: unknown): void;
  export function fromPoints(points: number[][], opts?: Record<string, unknown>): unknown;
  export function fromText(text: string, opts?: Record<string, unknown>): unknown;
  export function shapes(): string[];
  const AuroraField: { create: typeof create; register: typeof register; fromPoints: typeof fromPoints; fromText: typeof fromText };
  export default AuroraField;
}
