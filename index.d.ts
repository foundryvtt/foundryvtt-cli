import { CompileOptions } from "./lib/package.mjs";

declare module "foundryvtt-cli" {
  /**
   * Compile source files into a compendium pack.
   * @param {string} src   The directory containing the source files.
   * @param {string} dest  The target compendium pack. This should be a directory for LevelDB packs, or a .db file for
   *                       NeDB packs.
   * @param {CompileOptions} [options]
   * @returns {Promise<void>}
   */
  export function compilePack(
    src: string,
    dest: string,
    options: CompileOptions
  ): Promise<void>;
}
