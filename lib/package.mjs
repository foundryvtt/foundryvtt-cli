import fs from "fs";
import path from "path";
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
 * @property {object} [yamlOptions]             Options to pass to yaml.dump when serializing Documents.
 * @property {JSONOptions} [jsonOptions]        Options to pass to JSON.stringify when serializing Documents.
 * @property {DocumentType} [documentType]      Required only for NeDB packs in order to generate a correct key.
 * @property {boolean} [clean]                  Delete the destination directory before unpacking.
 * @property {DocumentCollection} [collection]  Required only for NeDB packs in order to generate a correct key. Can be
 *                                              used instead of documentType if known.
 * @property {NameTransformer} [transformName]  A function that is used to generate a filename for the extracted
 *                                              Document. If used, the generated name must include the appropriate file
 *                                              extension. The generated name will be resolved against the root path
 *                                              provided to the operation, and the entry will be written to that
 *                                              resolved location.
 */

/**
 * @typedef {object} JSONOptions
 * @property {JSONReplacer|Array<string|number>} [replacer]  A replacer function or an array of property names in the
 *                                                           object to include in the resulting string.
 * @property {string|number} [space]                         A number of spaces or a string to use as indentation.
 */

/**
 * @callback JSONReplacer
 * @param {string} key  The key being stringified.
 * @param {any} value   The value being stringified.
 * @returns {any}       The value returned is substituted instead of the current property's value.
 */

/**
 * @callback EntryTransformer
 * @param {object} entry           The entry data.
 * @returns {Promise<false|void>}  Return boolean false to indicate that this entry should be discarded.
 */

/**
 * @callback NameTransformer
 * @param {object} entry            The entry data.
 * @returns {Promise<string|void>}  If a string is returned, it is used as the filename that the entry will be written
 *                                  to.
 */

/**
 * @callback HierarchyApplyCallback
 * @param {object} doc              The Document being operated on.
 * @param {string} collection       The Document's collection.
 * @param {object} [options]        Additional options supplied by the invocation on the level above this one.
 * @returns {Promise<object|void>}  Options to supply to the next level of the hierarchy.
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
    combatants: []
  },
  delta: {
    items: [],
    effects: []
  },
  items: {
    effects: []
  },
  journal: {
    pages: []
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
      throw new Error(`An entry with key '${key}' was already packed and would be overwritten by this entry.`);
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
  nedb=false, yaml=false, yamlOptions={}, jsonOptions={}, log=false, documentType, collection, clean, transformEntry,
  transformName
}={}) {
  if ( nedb && (path.extname(src) !== ".db") ) {
    throw new Error("The nedb option was passed to extractPacks, but the target pack does not have a .db extension.");
  }
  collection ??= TYPE_COLLECTION_MAP[documentType];
  if ( nedb && !collection ) {
    throw new Error("For NeDB operations, a documentType or collection must be provided.");
  }
  if ( clean ) fs.rmSync(dest, { force: true, recursive: true, maxRetries: 10 });
  // Create the output directory if it doesn't exist already.
  fs.mkdirSync(dest, { recursive: true });
  if ( nedb ) {
    return extractNedb(src, dest, { yaml, yamlOptions, jsonOptions, log, collection, transformEntry, transformName });
  }
  return extractClassicLevel(src, dest, { yaml, log, yamlOptions, jsonOptions, transformEntry, transformName });
}

/* -------------------------------------------- */

/**
 * Extract a NeDB compendium pack into individual source files for each primary Document.
 * @param {string} pack  The source compendium pack.
 * @param {string} dest  The root output directory.
 * @param {Partial<ExtractOptions>} [options]
 * @returns {Promise<void>}
 */
async function extractNedb(pack, dest, {
  yaml, yamlOptions, jsonOptions, log, collection, transformEntry, transformName
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
    serializeDocument(doc, filename, { yaml, yamlOptions, jsonOptions });
    if ( log ) console.log(`Wrote ${chalk.blue(name)}`);
  }
}

/* -------------------------------------------- */

/**
 * Extract a LevelDB pack into individual source files for each primary Document.
 * @param {string} pack  The source compendium pack.
 * @param {string} dest  The root output directory.
 * @param {Partial<ExtractOptions>} [options]
 * @returns {Promise<void>}
 */
async function extractClassicLevel(pack, dest, {
  yaml, yamlOptions, jsonOptions, log, transformEntry, transformName
}) {
  // Load the directory as a ClassicLevel DB.
  const db = new ClassicLevel(pack, { keyEncoding: "utf8", valueEncoding: "json" });

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
    let name = await transformName?.(doc);
    if ( !name ) {
      name = `${doc.name ? `${getSafeFilename(doc.name)}_${id}` : key}.${yaml ? "yml" : "json"}`;
    }
    const filename = path.join(dest, name);
    serializeDocument(doc, filename, { yaml, yamlOptions, jsonOptions });
    if ( log ) console.log(`Wrote ${chalk.blue(name)}`);
  }

  await db.close();
}

/* -------------------------------------------- */
/*  Utilities                                   */
/* -------------------------------------------- */

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
    serialized = JSON.stringify(doc, replacer, space);
  }
  fs.writeFileSync(filename, serialized + "\n");
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
