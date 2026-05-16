/**
 * Type declarations for speech-rule-engine UMD bundle.
 * SRE does not ship declaration files for its bundled build.
 */

declare module 'speech-rule-engine/lib/sre.js' {
  export interface SREInstance {
    toSpeech(mathml: string): string;
    setupEngine(options: Record<string, unknown>): Promise<void>;
    engineReady(): Promise<void>;
    engineSetup(): Record<string, unknown>;
    localeLoader(): (loc: string) => Promise<string>;
    version: string;
    // Navigation methods (not used here)
    walk(mathml: string): string;
    move(keycode: string): string;
    // Number verbalisation
    number(input: string | number): string;
    ordinal(input: string | number): string;
    numericOrdinal(input: string | number): string;
    vulgar(input: string): string;
    // File API (Node only)
    file: {
      toSpeech(input: string, output?: string): string;
      toSemantic(input: string, output?: string): string;
      toJson(input: string, output?: string): string;
      toDescription(input: string, output?: string): string;
      toEnriched(input: string, output?: string): string;
    };
    // Worker API
    worker: Record<string, unknown>;
    // CLI
    cli: unknown;
    exit: unknown;
  }

  const SRE: SREInstance;
  export default SRE;
}
