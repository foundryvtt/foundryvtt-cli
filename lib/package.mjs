import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Datastore from "nedb-promises";
import chalk from "chalk";
import { default as YAML } from "js-yaml";
import { ClassicLevel } from "classic-level";

/* -------------------------------------------- */
/*  Configuration                               */
/* -------------------------------------------- */

/**
 * @typedef {
 *   "Actor"|"Adventure"|"Cards"|"ChatMessage"|"Combat"|"FogExploration"|"Folder"|"Item"|"JournalEntry"|"Macro"|
 *   "Playlist"|"RollTable"|"Scene"|"Setting"|"User"
 * } DocumentType
 */

/**
 * @typedef {
 *   "actors"|"adventures"|"cards"|"messages"|"combats"|"fog"|"folders"|"items"|"journal"|"macros"|"playlists"|"tables"|
 *   "scenes"|"settings"|"users"
 * } DocumentCollection
 */

/**
 * @typedef {object} PackageOptions
 * @property {boolean} [nedb=false]               Whether to operate on a NeDB database, otherwise a LevelDB database is
 *                                                assumed.
 * @property {boolean} [yaml=false]               Whether the source files are in YAML format, otherwise JSON is
 *                                                assumed.
 * @property {boolean} [log=false]                Whether to log operation progress to the console.
 * @property {EntryTransformer} [transformEntry]  A function that is called on every entry to transform it.
 */

/**
 * @typedef {PackageOptions} CompileOptions
 * @property {boolean} [recursive=false]  Whether to recurse into child directories to locate source files, otherwise
 *                                        only source files located in the root directory will be used.
 */

/**
 * @typedef {PackageOptions} ExtractOptions
 * @property {object} [yamlOptions]                   Options to pass to yaml.dump when serializing Documents.
 * @property {JSONOptions} [jsonOptions]              Options to pass to JSON.stringify when serializing Documents.
 * @property {DocumentType} [documentType]            Required only for NeDB packs in order to generate a correct key.
 * @property {boolean} [clean]                        Delete the destination directory before unpacking.
 * @property {boolean} [folders]                      Create a directory structure that matches the compendium folders.
 * @property {boolean} [expandAdventures]             Write documents embedded in Adventures to their own files. If the
 *                                                    folders option is also supplied, the Adventure is treated like a
 *                                                    folder, and all its entries are grouped into sub-folders by
 *                                                    Document type.
 * @property {boolean} [omitVolatile]                 Do not overwrite an existing entry if the new one has changes to
 *                                                    non-volatile fields. Currently, _stats.createdTime,
 *                                                    _stats.modifiedTime, _stats.lastModifiedBy, _stats.systemVersion,
 *                                                    and _stats.coreVersion are considered volatile.
 * @property {DocumentCollection} [collection]        Required only for NeDB packs in order to generate a correct key.
 *                                                    Can be used instead of documentType if known.
 * @property {NameTransformer} [transformName]        A function that is used to generate a filename for the extracted
 *                                                    Document. If used, the generated name must include the appropriate
 *                                                    file extension. The generated name will be resolved against the
 *                                                    root path provided to the operation, and the entry will be written
 *                                                    to that resolved location.
 * @property {NameTransformer} [transformFolderName]  A function used to generate a filename for an extracted folder
 *                                                    when the folders option is enabled.
 */

/**
 * @typedef {object} JSONOptions
 * @property {JSONReplacer|Array<string|number>} [replacer]  A replacer function or an array of property names in the
 *                                                           object to include in the resulting string.
 * @property {string|number} [space]                         A number of spaces or a string to use as indentation.
 */

/**
 * @typedef FolderDescriptor
 * @property {string} name      The folder's filename.
 * @property {string} [folder]  A parent folder ID.
 */

/**
 * @callback JSONReplacer
 * @param {string} key  The key being stringified.
 * @param {any} value   The value being stringified.
 * @returns {any}       The value returned is substituted instead of the current property's value.
 */

/**
 * @callback EntryTransformer
 * @param {object} entry                      The entry data.
 * @param {TransformerContext} [context]      Optional context information for the document being transformed.
 * @returns {Promise<false|void>}             Return boolean false to indicate that this entry should be discarded.
 */

/**
 * @callback NameTransformer
 * @param {object} entry                      The entry data.
 * @param {TransformerContext} [context]      Optional context information for the document being transformed.
 * @returns {Promise<string|void>}            If a string is returned, it is used as the filename that the entry will
 *                                            be written to.
 */

/**
 * @typedef TransformerContext
 * @property {object} [adventure]       Data on an adventure if document is stored within an adventure.
 * @property {object} [adventure.doc]   The entire adventure document.
 * @property {string} [adventure.path]  The path where the adventure will be extracted.
 * @property {string} [folder]          Folder path if this entry is in a folder and the folders option is enabled.
 */

/**
 * @callback HierarchyApplyCallback
 * @param {object} doc              The Document being operated on.
 * @param {string} collection       The Document's collection.
 * @param {object} [options]        Additional options supplied by the invocation on the level above this one.
 * @returns {Promise<object|void>}  Options to supply to the next level of the hierarchy.
 */

/**
 * @callback HierarchyApplySyncCallback
 * @param {object} doc         The Document being operated on.
 * @param {string} collection  The Document's collection.
 * @param {number|null} i      The Document's index in its parent collection.
 * @param {object} [options]   Additional options supplied by the invocation on the level above this one.
 * @returns {object|void}
 */

/**
 * @callback HierarchyMapCallback
 * @param {any} entry          The element stored in the collection.
 * @param {string} collection  The collection name.
 * @returns {Promise<any>}
 */

/**
 * A flattened view of the Document hierarchy. The type of the value determines what type of collection it is. Arrays
 * represent embedded collections, while objects represent embedded documents.
 * @type {Record<string, Record<string, object|Array>>}
 */
const HIERARCHY = {
  actors: {
    items: [],
    effects: []
  },
  cards: {
    cards: []
  },
  combats: {
    combatants: [],
    groups: []
  },
  delta: {
    items: [],
    effects: []
  },
  items: {
    effects: []
  },
  journal: {
    pages: [],
    categories: []
  },
  playlists: {
    sounds: []
  },
  regions: {
    behaviors: []
  },
  tables: {
    results: []
  },
  tokens: {
    delta: {}
  },
  scenes: {
    drawings: [],
    tokens: [],
    lights: [],
    notes: [],
    regions: [],
    sounds: [],
    templates: [],
    tiles: [],
    walls: []
  }
};

/**
 * Document collections stored with adventure documents.
 * @type {string[]}
 */
const ADVENTURE_DOCS = [
  "actors", "cards", "combats", "folders", "items", "journal", "playlists", "scenes", "tables", "macros"
];

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
  User: "users"
};

/**
 * A mapping of collection names to primary document types.
 * @type {Record<DocumentCollection, DocumentType>}
 */
export const COLLECTION_TYPE_MAP = Object.fromEntries(Object.entries(TYPE_COLLECTION_MAP).map(([k, v]) => [v, k]));

/**
 * When extracting an entry, if the newly-extracted entry has only these fields changed, then ignore it.
 * @type {string[]}
 */
const VOLATILE_FIELDS = ["createdTime", "modifiedTime", "lastModifiedBy", "systemVersion", "coreVersion"];

/* -------------------------------------------- */
/*  Compiling                                   */
/* -------------------------------------------- */

/**
 * Compile source files into a compendium pack.
 * @param {string} src   The directory containing the source files.
 * @param {string} dest  The target compendium pack. This should be a directory for LevelDB packs, or a .db file for
 *                       NeDB packs.
 * @param {CompileOptions} [options]
 * @returns {Promise<void>}
 */
export async function compilePack(src, dest, {
  nedb=false, yaml=false, recursive=false, log=false, transformEntry
}={}) {
  if ( nedb && (path.extname(dest) !== ".db") ) {
    throw new Error("The nedb option was passed to compilePacks, but the target pack does not have a .db extension.");
  }
  const files = findSourceFiles(src, { yaml, recursive });
  if ( nedb ) return compileNedb(dest, files, { log, transformEntry });
  return compileClassicLevel(dest, files, { log, transformEntry });
}

/* -------------------------------------------- */

/**
 * Compile a set of files into a NeDB compendium pack.
 * @param {string} pack     The target compendium pack.
 * @param {string[]} files  The source files.
 * @param {Partial<PackageOptions>} [options]
 * @returns {Promise<void>}
 */
async function compileNedb(pack, files, { log, transformEntry }={}) {
  // Delete the existing NeDB file if it exists.
  try {
    fs.unlinkSync(pack);
  } catch ( err ) {
    if ( err.code !== "ENOENT" ) throw err;
  }

  // Create a new NeDB Datastore.
  const db = Datastore.create(pack);
  const seenKeys = new Set();
  const packDoc = applyHierarchy(doc => {
    if ( seenKeys.has(doc._key) ) {
      throw new Error(`An entry with key '${doc._key}' was already packed and would be overwritten by this entry.`);
    }
    seenKeys.add(doc._key);
    delete doc._key;
  });

  // Iterate over all source files, writing them to the DB.
  for ( const file of files ) {
    try {
      const contents = fs.readFileSync(file, "utf8");
      const ext = path.extname(file);
      const isYaml = ext === ".yml" || ext === ".yaml";
      const doc = isYaml ? YAML.load(contents) : JSON.parse(contents);
      if ( !doc._key ) continue;
      if ( doc._key.startsWith("!adventures") ) await reconstructAdventure(path.dirname(file), doc, {
        transformEntry, log
      });
      const key = doc._key;
      const [, collection] = key.split("!");
      // If the key starts with !folders, we should skip packing it as NeDB doesn't support folders.
      if ( key.startsWith("!folders") ) continue;
      if ( await transformEntry?.(doc) === false ) continue;
      await packDoc(doc, collection);
      await db.insert(doc);
      if ( log ) console.log(`Packed ${chalk.blue(doc._id)}${chalk.blue(doc.name ? ` (${doc.name})` : "")}`);
    } catch ( err ) {
      if ( log ) console.error(`Failed to pack ${chalk.red(file)}. See error below.`);
      throw err;
    }
  }

  // Compact the DB.
  db.stopAutocompaction();
  await new Promise(resolve => db.compactDatafile(resolve));
}

/* -------------------------------------------- */

/**
 * Compile a set of files into a LevelDB compendium pack.
 * @param {string} pack  The target compendium pack.
 * @param {string[]} files  The source files.
 * @param {Partial<PackageOptions>} [options]
 * @returns {Promise<void>}
 */
async function compileClassicLevel(pack, files, { log, transformEntry }={}) {
  // Create the classic level directory if it doesn't already exist.
  fs.mkdirSync(pack, { recursive: true });

  // Load the directory as a ClassicLevel DB.
  const db = new ClassicLevel(pack, { keyEncoding: "utf8", valueEncoding: "json" });
  const batch = db.batch();
  const seenKeys = new Set();

  const packDoc = applyHierarchy(async (doc, collection) => {
    const key = doc._key;
    delete doc._key;
    if ( seenKeys.has(key) ) {
      throw new Error(`An entry with key '${key}' was already packed and would be overwritten by this entry.`);
    }
    seenKeys.add(key);
    const value = structuredClone(doc);
    await mapHierarchy(value, collection, d => d._id);
    batch.put(key, value);
  });

  // Iterate over all files in the input directory, writing them to the DB.
  for ( const file of files ) {
    try {
      const contents = fs.readFileSync(file, "utf8");
      const ext = path.extname(file);
      const isYaml = ext === ".yml" || ext === ".yaml";
      const doc = isYaml ? YAML.load(contents) : JSON.parse(contents);
      if ( !doc._key ) continue;
      if ( doc._key.startsWith("!adventures") ) await reconstructAdventure(path.dirname(file), doc, {
        transformEntry, log
      });
      const [, collection] = doc._key.split("!");
      if ( await transformEntry?.(doc) === false ) continue;
      await packDoc(doc, collection);
      if ( log ) console.log(`Packed ${chalk.blue(doc._id)}${chalk.blue(doc.name ? ` (${doc.name})` : "")}`);
    } catch ( err ) {
      if ( log ) console.error(`Failed to pack ${chalk.red(file)}. See error below.`);
      throw err;
    }
  }

  // Remove any entries in the DB that are not part of the source set.
  for ( const key of await db.keys().all() ) {
    if ( !seenKeys.has(key) ) {
      batch.del(key);
      if ( log ) console.log(`Removed ${chalk.blue(key)}`);
    }
  }

  await batch.write();
  await compactClassicLevel(db);
  await db.close();
}

/* -------------------------------------------- */

/**
 * Collect any documents linked within an adventure.
 * @param {string} src  The Adventure document's source directory.
 * @param {object} doc  Adventure document being reconstructed.
 * @param {Partial<PackageOptions>} [options]
 * @returns {Promise<void>}
 */
async function reconstructAdventure(src, doc, { transformEntry, log }={}) {
  const context = { adventure: doc };
  for ( const embeddedCollectionName of ADVENTURE_DOCS ) {
    const entries = [];
    for ( let entry of doc[embeddedCollectionName] ?? [] ) {
      if ( typeof entry === "string" ) {
        const file = path.join(src, entry);
        let contents;
        try {
          contents = fs.readFileSync(file, "utf8");
        } catch ( err ) {
          if ( log ) console.error(`Failed to pack ${chalk.red(file)} as part of Adventure reconstruction.`);
          throw err;
        }
        const ext = path.extname(file);
        const isYaml = ext === ".yml" || ext === ".yaml";
        entry = isYaml ? YAML.load(contents) : JSON.parse(contents);
        if ( await transformEntry?.(entry, context) === false ) continue;
      }
      entries.push(entry);
    }
    doc[embeddedCollectionName] = entries;
  }
}

/* -------------------------------------------- */

/**
 * Flushes the log of the given database to create compressed binary tables.
 * @param {ClassicLevel} db The database to compress.
 * @returns {Promise<void>}
 */
async function compactClassicLevel(db) {
  const forwardIterator = db.keys({ limit: 1, fillCache: false });
  const firstKey = await forwardIterator.next();
  await forwardIterator.close();

  const backwardIterator = db.keys({ limit: 1, reverse: true, fillCache: false });
  const lastKey = await backwardIterator.next();
  await backwardIterator.close();

  if ( firstKey && lastKey ) return db.compactRange(firstKey, lastKey, { keyEncoding: "utf8" });
}

/* -------------------------------------------- */
/*  Extracting                                  */
/* -------------------------------------------- */

/**
 * Extract the contents of a compendium pack into individual source files for each primary Document.
 * @param {string} src   The source compendium pack. This should be a directory for LevelDB pack, or a .db file for
 *                       NeDB packs.
 * @param {string} dest  The directory to write the extracted files into.
 * @param {ExtractOptions} [options]
 * @returns {Promise<void>}
 */
export async function extractPack(src, dest, {
  nedb=false, yaml=false, yamlOptions={}, jsonOptions={}, log=false, documentType, collection, clean, folders,
  expandAdventures, omitVolatile, transformEntry, transformName, transformFolderName
}={}) {
  if ( nedb && (path.extname(src) !== ".db") ) {
    throw new Error("The nedb option was passed to extractPacks, but the target pack does not have a .db extension.");
  }
  collection ??= TYPE_COLLECTION_MAP[documentType];
  if ( nedb && !collection ) {
    throw new Error("For NeDB operations, a documentType or collection must be provided.");
  }
  const tmp = path.join(os.tmpdir(), "foundryvtt-cli",
    `${Date.now()}-${performance.now().toString().replace(".", "-")}`);
  // Create the output directory if it doesn't exist already.
  fs.mkdirSync(dest, { recursive: true });
  fs.mkdirSync(tmp, { recursive: true });
  try {
    if ( nedb ) {
      await extractNedb(src, tmp, {
        yaml, yamlOptions, jsonOptions, omitVolatile, log, collection, transformEntry, transformName, existing: dest
      });
    }
    await extractClassicLevel(src, tmp, {
      yaml, log, yamlOptions, jsonOptions, folders, expandAdventures, omitVolatile, transformEntry, transformName,
      transformFolderName, existing: dest
    });
    if ( clean ) fs.rmSync(dest, { force: true, recursive: true, maxRetries: 10 });
    fs.cpSync(tmp, dest, { force: true, recursive: true });
  } finally {
    fs.rmSync(tmp, { force: true, recursive: true, maxRetries: 10 });
  }
}

/* -------------------------------------------- */

/**
 * Extract a NeDB compendium pack into individual source files for each primary Document.
 * @param {string} pack                The source compendium pack.
 * @param {string} dest                The root output directory.
 * @param {Partial<ExtractOptions>} [options]
 * @param {string} [options.existing]  The location of existing serialized Documents.
 * @returns {Promise<void>}
 */
async function extractNedb(pack, dest, {
  yaml, yamlOptions, jsonOptions, omitVolatile, log, collection, transformEntry, transformName, existing
}={}) {
  // Load the NeDB file.
  const db = new Datastore({ filename: pack, autoload: true });

  const unpackDoc = applyHierarchy((doc, collection, { sublevelPrefix, idPrefix }={}) => {
    const sublevel = keyJoin(sublevelPrefix, collection);
    const id = keyJoin(idPrefix, doc._id);
    doc._key = `!${sublevel}!${id}`;
    return { sublevelPrefix: sublevel, idPrefix: id };
  });

  // Iterate over all entries in the DB, writing them as source files.
  const docs = await db.find({});
  for ( const doc of docs ) {
    await unpackDoc(doc, collection);
    if ( await transformEntry?.(doc) === false ) continue;
    let name = await transformName?.(doc);
    if ( !name ) {
      name = `${doc.name ? `${getSafeFilename(doc.name)}_${doc._id}` : doc._id}.${yaml ? "yml" : "json"}`;
    }
    const filename = path.join(dest, name);
    serializeDocument(checkVolatile(doc, name, { collection, omitVolatile, existing, yaml }), filename, {
      yaml, yamlOptions, jsonOptions
    });
    if ( log ) console.log(`Wrote ${chalk.blue(name)}`);
  }
}

/* -------------------------------------------- */

/**
 * Extract a LevelDB pack into individual source files for each primary Document.
 * @param {string} pack                The source compendium pack.
 * @param {string} dest                The root output directory.
 * @param {Partial<ExtractOptions>} [options]
 * @param {string} [options.existing]  The location of existing serialized Documents.
 * @returns {Promise<void>}
 */
async function extractClassicLevel(pack, dest, {
  yaml, yamlOptions, jsonOptions, log, folders, expandAdventures, omitVolatile, transformEntry, transformName,
  transformFolderName, existing
}={}) {
  // Load the directory as a ClassicLevel DB.
  const db = new ClassicLevel(pack, { keyEncoding: "utf8", valueEncoding: "json", createIfMissing: false });

  // Build up the folder structure
  let folderMap = new Map();
  if ( folders ) {
    const keys = (await db.keys().all()).filter(k => k.startsWith("!folders"));
    folderMap = await buildFolderMap(await db.getMany(keys), { transformFolderName });
  }

  const unpackDoc = applyHierarchy(async (doc, collection, { sublevelPrefix, idPrefix }={}) => {
    const sublevel = keyJoin(sublevelPrefix, collection);
    const id = keyJoin(idPrefix, doc._id);
    doc._key = `!${sublevel}!${id}`;
    await mapHierarchy(doc, collection, (embeddedId, embeddedCollectionName) => {
      return db.get(`!${sublevel}.${embeddedCollectionName}!${id}.${embeddedId}`);
    });
    return { sublevelPrefix: sublevel, idPrefix: id };
  });

  // Iterate over all entries in the DB, writing them as source files.
  for await ( const [key, doc] of db.iterator() ) {
    const [, collection, id] = key.split("!");
    if ( collection.includes(".") ) continue; // This is not a primary document, skip it.
    await unpackDoc(doc, collection);
    if ( await transformEntry?.(doc) === false ) continue;
    if ( key.startsWith("!adventures") && expandAdventures ) {
      await extractAdventure(doc, dest, { folderMap }, {
        yaml, yamlOptions, jsonOptions, log, folders, omitVolatile, transformEntry, transformName, existing
      });
      continue;
    }
    const folder = folderMap.get(doc.folder)?.path;
    let name = await transformName?.(doc, { folder });
    if ( !name ) {
      if ( key.startsWith("!folders") && folderMap.has(doc._id) ) {
        const folder = folderMap.get(doc._id);
        name = path.join(folder.name, `_Folder.${yaml ? "yml" : "json"}`);
      } else {
        name = `${doc.name ? `${getSafeFilename(doc.name)}_${id}` : key}.${yaml ? "yml" : "json"}`;
      }
      if ( folder ) name = path.join(folder, name);
    }
    const filename = path.join(dest, name);
    serializeDocument(checkVolatile(doc, name, { collection, omitVolatile, existing, yaml }), filename, {
      yaml, yamlOptions, jsonOptions
    });
    if ( log ) console.log(`Wrote ${chalk.blue(name)}`);
  }

  await db.close();
}

/* -------------------------------------------- */

/**
 * Split an adventure document into separate files.
 * @param {object} doc                                The Document being operated on.
 * @param {string} dest                               The root output directory.
 * @param {object} [adventureOptions]                 Options to configure adventure extraction behavior.
 * @param {Map<string, FolderDescriptor>} [adventureOptions.folderMap]  Folder hierarchy.
 * @param {Partial<ExtractOptions>} [extractOptions]  Options to configure serialization behavior.
 * @param {string} [extractOptions.existing]          The location of existing serialized Documents.
 */
async function extractAdventure(doc, dest, { folderMap }={}, {
  yaml, yamlOptions, jsonOptions, log, folders, omitVolatile, transformEntry, transformName, transformFolderName, existing
}={}) {
  let adventureFolder;

  // Prepare name for the adventure
  const folder = folderMap?.get(doc.folder)?.path;
  let name = await transformName?.(doc, { folder });
  adventureFolder = folders ? path.join(folder ?? "", `${getSafeFilename(doc.name)}_${doc._id}`) : folder;
  if ( !name ) {
    if ( folders ) {
      name = path.join(adventureFolder, `_Adventure.${yaml ? "yml" : "json"}`);
    } else {
      name = `${doc.name ? `${getSafeFilename(doc.name)}_${doc._id}` : doc._id}.${yaml ? "yml" : "json"}`;
      if ( folder ) name = path.join(folder, name);
    }
  }
  const context = { adventure: { doc, path: name } };

  // Build up the folder structure
  const embeddedFolderMap = folders
    ? await buildFolderMap(doc.folders ?? [], { groupByType: true, transformFolderName })
    : new Map();

  // Write all documents contained in the adventure
  for ( const embeddedCollectionName of ADVENTURE_DOCS ) {
    const paths = [];
    const typeSuffix = folders ? "" : `_${COLLECTION_TYPE_MAP[embeddedCollectionName]}`;
    for ( const embeddedDoc of doc[embeddedCollectionName] ?? [] ) {
      if ( await transformEntry?.(embeddedDoc, context) === false ) continue;
      let embeddedFolder = path.join(adventureFolder ?? "", embeddedFolderMap.get(embeddedDoc.folder)?.path ?? "");
      let embeddedName = await transformName?.(embeddedDoc, { ...context, folder: embeddedFolder });
      if ( !embeddedName ) {
        const { name, _id: id } = embeddedDoc;
        if ( (embeddedCollectionName === "folders") && embeddedFolderMap.has(embeddedDoc._id) ) {
          embeddedFolder = adventureFolder;
          embeddedName = path.join(embeddedFolderMap.get(embeddedDoc._id).path, `_Folder.${yaml ? "yml" : "json"}`);
        } else {
          embeddedName = `${name ? `${getSafeFilename(name)}${typeSuffix}_${id}` : doc._id}.${yaml ? "yml" : "json"}`;
        }
        if ( embeddedFolder ) embeddedName = path.join(embeddedFolder, embeddedName);
      }
      const filename = path.join(dest, embeddedName);
      const embeddedPath =
        adventureFolder ? path.relative(adventureFolder, embeddedName) : path.basename(embeddedName);
      paths.push(path.posix.join(...embeddedPath.split(path.sep)));
      serializeDocument(checkVolatile(embeddedDoc, embeddedName, {
        omitVolatile, existing, yaml,
        collection: embeddedCollectionName
      }), filename, {
        yaml, yamlOptions, jsonOptions
      });
      if ( log ) console.log(`Wrote ${chalk.blue(embeddedName)}`);
    }
    doc[embeddedCollectionName] = paths;
  }

  // Write the adventure itself
  const filename = path.join(dest, name);
  serializeDocument(checkVolatile(doc, name, { omitVolatile, existing, yaml }), filename, {
    yaml, yamlOptions, jsonOptions
  });
  if ( log ) console.log(`Wrote ${chalk.blue(name)}`);
}

/* -------------------------------------------- */
/*  Utilities                                   */
/* -------------------------------------------- */

/**
 * Repair pack
 * @param {string} pack                The source compendium pack.
 * @param {object} options             Additional options
 * @param {boolean} [log]              Log progress
 */
export async function repairPack(pack, { log = false } = {}) {
  if ( log ) console.log(`Repairing ${chalk.blue(pack)}`);
  await ClassicLevel.repair(pack);
  if ( log ) console.log("Repair complete");
}

/**
 * Wrap a function so that it can be applied recursively to a Document's hierarchy.
 * @param {HierarchyApplyCallback} fn  The function to wrap.
 * @returns {HierarchyApplyCallback}   The wrapped function.
 */
function applyHierarchy(fn) {
  const apply = async (doc, collection, options={}) => {
    const newOptions = await fn(doc, collection, options);
    for ( const [embeddedCollectionName, type] of Object.entries(HIERARCHY[collection] ?? {}) ) {
      const embeddedValue = doc[embeddedCollectionName];
      if ( Array.isArray(type) && Array.isArray(embeddedValue) ) {
        for ( const embeddedDoc of embeddedValue ) await apply(embeddedDoc, embeddedCollectionName, newOptions);
      }
      else if ( embeddedValue ) await apply(embeddedValue, embeddedCollectionName, newOptions);
    }
  };
  return apply;
}

/* -------------------------------------------- */

/**
 * Wrap a synchronous function so that it can be applied recursively to a Document's hierarchy.
 * @param {HierarchyApplySyncCallback} fn  The function to wrap.
 * @returns {HierarchyApplySyncCallback}   The wrapped function.
 */
function applyHierarchySync(fn) {
  return function apply(doc, collection, i, options={}) {
    const newOptions = fn(doc, collection, i, options);
    for ( const [embeddedCollectionName, type] of Object.entries(HIERARCHY[collection] ?? {}) ) {
      const embeddedValue = doc[embeddedCollectionName];
      if ( Array.isArray(type) && Array.isArray(embeddedValue) ) {
        for ( let i = 0; i < embeddedValue.length; i++ ) {
          apply(embeddedValue[i], embeddedCollectionName, i, newOptions);
        }
      }
      else if ( embeddedValue ) apply(embeddedValue, embeddedCollectionName, -1, newOptions);
    }
  };
}

/* -------------------------------------------- */

/**
 * Build up the folder structure used to extract files.
 * @param {object[]} folders                               Folders to process.
 * @param {object} [options={}]
 * @param {boolean} [options.groupByType=false]            Should folders be in sub-folders based on document type?
 * @param {NameTransformer} [options.transformFolderName]  Name transformer.
 * @returns {Map<string, string>}                          Mapping of folder IDs to paths.
 */
async function buildFolderMap(folders, { groupByType=false, transformFolderName }={}) {
  const folderMap = new Map();
  for ( const doc of folders ) {
    let name = await transformFolderName?.(doc);
    if ( !name ) name = doc.name ? `${getSafeFilename(doc.name)}_${doc._id}` : doc._id;
    folderMap.set(doc._id, { name, folder: doc.folder, type: doc.type });
  }
  for ( const folder of folderMap.values() ) {
    let parent = folderMap.get(folder.folder);
    folder.path = folder.name;
    while ( parent ) {
      folder.path = path.join(parent.name, folder.path);
      parent = folderMap.get(parent.folder);
    }
    if ( groupByType ) folder.path = path.join(folder.type, folder.path);
  }
  return folderMap;
}

/* -------------------------------------------- */

/**
 * Transform a Document's embedded collections by applying a function to them.
 * @param {object} doc               The Document being operated on.
 * @param {string} collection        The Document's collection.
 * @param {HierarchyMapCallback} fn  The function to invoke.
 */
async function mapHierarchy(doc, collection, fn) {
  for ( const [embeddedCollectionName, type] of Object.entries(HIERARCHY[collection] ?? {}) ) {
    const embeddedValue = doc[embeddedCollectionName];
    if ( Array.isArray(type) ) {
      if ( Array.isArray(embeddedValue) ) {
        doc[embeddedCollectionName] = await Promise.all(embeddedValue.map(entry => {
          return fn(entry, embeddedCollectionName);
        }));
      }
      else doc[embeddedCollectionName] = [];
    } else {
      if ( embeddedValue ) doc[embeddedCollectionName] = await fn(embeddedValue, embeddedCollectionName);
      else doc[embeddedCollectionName] = null;
    }
  }
}

/* -------------------------------------------- */

/**
 * Locate all source files in the given directory.
 * @param {string} root  The root directory to search in.
 * @param {Partial<CompileOptions>} [options]
 * @returns {string[]}
 */
function findSourceFiles(root, { yaml=false, recursive=false }={}) {
  const files = [];
  for ( const entry of fs.readdirSync(root, { withFileTypes: true }) ) {
    const name = path.join(root, entry.name);
    if ( entry.isDirectory() && recursive ) {
      files.push(...findSourceFiles(name, { yaml, recursive }));
      continue;
    }
    if ( !entry.isFile() ) continue;
    const ext = path.extname(name);
    const isYaml = (ext === ".yml") || (ext === ".yaml");
    if ( yaml && isYaml ) files.push(name);
    else if ( !yaml && (ext === ".json") ) files.push(name);
  }
  return files;
}

/* -------------------------------------------- */

/**
 * Serialize a Document and write it to the filesystem.
 * @param {object} doc                         The Document to serialize.
 * @param {string} filename                    The filename to write it to.
 * @param {Partial<ExtractOptions>} [options]  Options to configure serialization behavior.
 */
function serializeDocument(doc, filename, { yaml, yamlOptions, jsonOptions }={}) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  let serialized;
  if ( yaml ) serialized = YAML.dump(doc, yamlOptions);
  else {
    const { replacer=null, space=2 } = jsonOptions;
    serialized = JSON.stringify(doc, replacer, space) + "\n";
  }
  fs.writeFileSync(filename, serialized);
}

/* -------------------------------------------- */

/**
 * Check if only a Document's volatile fields have changed, and if so, do not write those changes.
 * @param {object} doc                      The candidate Document data.
 * @param {string} name                     The destination file name.
 * @param {object} [options]
 * @param {boolean} [options.omitVolatile]  Only write changes if some non-volatile fields have changed.
 * @param {string} [options.existing]       The location of the existing file.
 * @param {boolean} [options.yaml]          Whether the existing files are formatted with YAML.
 * @param {string} [options.collection]     The primaru Document collection, in order to perform hierarchical
 *                                          operations.
 * @returns {object}                        The data to write. Either the candidate data, or the existing data.
 */
function checkVolatile(doc, name, { omitVolatile, existing, yaml, collection }={}) {
  if ( !omitVolatile || !existing || !("_stats" in doc) ) return doc;
  const parse = yaml ? YAML.load : JSON.parse;
  try {
    const base = parse(fs.readFileSync(path.join(existing, name), { encoding: "utf8" }));
    if ( !base || !("_stats" in base) ) return doc;
    const copy = structuredClone(doc);
    const apply = applyHierarchySync((a, collection, i) => {
      const b = i === null ? base : i < 0 ? base[collection] : base[collection]?.[i];
      if ( !b || !("_stats" in b) ) return;
      for ( const p of VOLATILE_FIELDS ) {
        if ( p in b._stats ) a._stats[p] = b._stats[p];
      }
    });
    apply(copy, collection, null);
    return testEquality(base, copy) ? base : doc;
  } catch {
    return doc;
  }
}

/* -------------------------------------------- */

/**
 * Determine if two pieces of data are the same.
 * @param {string|number|boolean|object} a
 * @param {string|number|boolean|object} b
 * @param {number} [depth]
 * @returns {boolean}
 */
function testEquality(a, b, depth=0) {
  if ( depth > 100 ) throw new Error("cyclic structure detected");
  if ( typeof a !== typeof b ) return false;
  if ( (a === null) || (typeof a !== "object") ) return a === b;
  if ( Array.isArray(a) ) {
    if ( a.length !== b.length ) return false;
    return a.every((v, i) => testEquality(v, b[i], depth + 1));
  }
  const keysA = Object.keys(a);
  if ( keysA.length !== Object.keys(b).length ) return false;
  for ( const p of keysA ) {
    if ( !testEquality(a[p], b[p], depth + 1) ) return false;
  }
  return true;
}

/* -------------------------------------------- */

/**
 * Join non-blank key parts.
 * @param {...string} args  Key parts.
 * @returns {string}
 */
function keyJoin(...args) {
  return args.filter(_ => _).join(".");
}

/* -------------------------------------------- */

/**
 * Ensure a string is safe for use as a filename.
 * @param {string} filename         The filename to sanitize
 * @returns {string}                The sanitized filename
 */
function getSafeFilename(filename) {
  return filename.replace(/[^a-zA-Z0-9А-я]/g, '_');
}
