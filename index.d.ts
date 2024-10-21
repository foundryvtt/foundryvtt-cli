import { CompileOptions, ExtractOptions } from "./lib/package.mjs";

declare module "foundryvtt-cli" {
  /**
   * A mapping of primary document types to collection names.
   * @type {Record<DocumentType, DocumentCollection>}
   */
  export const TYPE_COLLECTION_MAP = {
    Actor: "actors",
    Adventure: "adventures",
    Cards: "cards",
    ChatMessage: "messages",
    Combat: "combats",
    FogExploration: "fog",
    Folder: "folders",
    Item: "items",
    JournalEntry: "journal",
    Macro: "macros",
    Playlist: "playlists",
    RollTable: "tables",
    Scene: "scenes",
    Setting: "settings",
    User: "users",
  };

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

  /**
   * Extract the contents of a compendium pack into individual source files for each primary Document.
   * @param {string} src   The source compendium pack. This should be a directory for LevelDB pack, or a .db file for
   *                       NeDB packs.
   * @param {string} dest  The directory to write the extracted files into.
   * @param {ExtractOptions} [options]
   * @returns {Promise<void>}
   */
  export async function extractPack(
    src: string,
    dest: string,
    options: ExtractOptions
  ): Promise<void>;
}
