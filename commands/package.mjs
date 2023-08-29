import Config from "../config.mjs";
import { ClassicLevel } from "classic-level";
import yaml from "js-yaml";
import path from "path";
import fs from "fs";
import chalk from "chalk";
import Datastore from "nedb-promises";

/**
 * @typedef {"Module"|"System"|"World"} PackageType
 */

/**
 * @typedef {
 *   "Actor"|"Cards"|"ChatMessage"|"Combat"|"FogExploration"|"Folder"|"Item"|"JournalEntry"|"Macro"|"Playlist"|
 *   "RollTable"|"Scene"|"Setting"|"User"
 * } DocumentType
 */

/**
 * @typedef {object} CLIArgs
 * @property {"workon"|"clear"|"unpack"|"pack"} action  The action to perform.
 * @property {string} value                             The action value.
 * @property {string} [id]                              Optionally provide the package ID if we are using explicit
 *                                                      paths.
 * @property {PackageType} type                         The package type.
 * @property {string} [compendiumName]                  The compendium name for pack-based actions.
 * @property {DocumentType} [compendiumType]            The type of Documents that the compendium houses. Only required
 *                                                      for NeDB operations.
 * @property {string} [inputDirectory]                  An explicit input directory for pack-based actions.
 * @property {string} [outputDirectory]                 An explicit output directory for pack-based actions.
 * @property {boolean} [yaml]                           Whether to use YAML instead of JSON for serialization.
 * @property {boolean} [verbose]                        Whether to output verbose logging.
 * @property {boolean} [nedb]                           Use NeDB instead of ClassicLevel for database operations.
 */

/**
 * A mapping of primary document types to collection names.
 * @type {Record<string, string>}
 */
const TYPE_COLLECTION_MAP = {
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
    sounds: [],
    templates: [],
    tiles: [],
    walls: []
  }
};

/**
 * The working package ID.
 * @type {string|null}
 */
let currentPackageId = Config.instance.get("currentPackageId");

/**
 * The working package type.
 * @type {PackageType|null}
 */
let currentPackageType = Config.instance.get("currentPackageType");

/**
 * Get the command object for the package command
 * @returns {CommandModule}
 */
export function getCommand() {
  return {
    command: "package [action] [value]",
    describe: "Manage packages",
    builder: yargs => {
      yargs.positional("action", {
        describe: "The action to perform",
        type: "string",
        choices: ["workon", "clear", "unpack", "pack"]
      });

      yargs.positional("value", {
        describe: "The value to use for the action",
        type: "string"
      });

      // currentPackageId is only needed if the data path has to be built with it.
      yargs.option("id", {
        describe: "The package ID",
        type: "string",
      });

      yargs.option("type", {
        describe: "The package type",
        type: "string",
        choices: ["Module", "System", "World"]
      });

      yargs.option("compendiumName", {
        alias: "n",
        describe: "The Compendium name, for Compendium Pack based Actions.",
        type: "string"
      });

      yargs.option("compendiumType", {
        alias: "t",
        describe: "The type of document that the compendium pack stores. Only necessary for NeDB operations.",
        type: "string",
        choices: Object.keys(TYPE_COLLECTION_MAP)
      });

      yargs.option("inputDirectory", {
        alias: "in",
        describe: "The directory to read from, for Pack based Actions.",
        type: "string"
      });

      yargs.option("outputDirectory", {
        alias: "out",
        describe: "The directory to write to, for Pack based Actions.",
        type: "string"
      });

      yargs.option("yaml", {
        describe: "Whether to use YAML instead of JSON for serialization.",
        type: "boolean"
      });

      yargs.option("verbose", {
        alias: "v",
        describe: "Whether to output verbose logging.",
        type: "boolean"
      });

      yargs.options("nedb", {
        describe: "Whether to use NeDB instead of ClassicLevel for database operations.",
        type: "boolean"
      });

      return yargs;
    },
    handler: async argv => {
      if ( argv.id ) currentPackageId = argv.id;
      if ( argv.type ) currentPackageType = argv.type;

      // Handle actions
      switch ( argv.action ) {
        case "workon": handleWorkon(argv); break;
        case "clear": handleClear(); break;
        case "unpack": await handleUnpack(argv); break;
        case "pack": await handlePack(argv); break;

        default:
          if ( !currentPackageId ) {
            console.error(chalk.red("No package ID is currently set. Use `package workon <id>` to set it."));
            return;
          }

          console.log(`Currently in ${chalk.magenta(currentPackageType)} ${chalk.cyan(currentPackageId)}`);
          break;
      }
    }
  }
}

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

/**
 * Replace all non-alphanumeric characters with an underscore in a filename
 * @param {string} filename         The filename to sanitize
 * @returns {string}                The sanitized filename
 */
function getSafeFilename(filename) {
  return filename.replace(/[^a-zA-Z0-9]/g, '_');
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
 * Read all the package manifests for a given package type, and return a Map of them, keyed by ID.
 * @param {string} dataPath                  The root data path.
 * @param {PackageType} type                 The package type.
 * @param {object} [options]
 * @param {boolean} [options.verbose=false]  Log errors verbosely.
 * @returns {Map<string, object>}
 */
function readPackageManifests(dataPath, type, { verbose=false }={}) {
  const typeLC = type.toLowerCase();
  const typePl = `${typeLC}s`;
  const dir = `${dataPath}/Data/${typePl}`;
  const map = new Map();

  for ( const file of fs.readdirSync(dir, { withFileTypes: true }) ) {
    const manifestPath = path.normalize(`${dir}/${file.name}/${typeLC}.json`);
    try {
      const data = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      data.type = type;
      data.path = manifestPath;
      map.set(data.id ?? data.name, data);
    } catch ( err ) {
      if ( verbose ) console.error(chalk.red(`Error reading ${typeLC}.json for ${chalk.blue(file.name)}: ${err}`));
    }
  }

  return map;
}

/* -------------------------------------------- */

/**
 * @typedef {object} DiscoveredPackages
 * @property {Map<string, object>} modules  A map of module manifest data by ID.
 * @property {Map<string, object>} systems  A map of system manifest data by ID.
 * @property {Map<string, object>} worlds   A map of world manifest data by ID.
 * @property {object[]} packages            A list of all packages in the data path.
 */

/**
 * Discover the list of all Packages in the dataPath
 * @param {CLIArgs} argv  The command line arguments
 * @returns {DiscoveredPackages|void}
 */
function discoverPackageDirectory(argv) {
  const dataPath = Config.instance.get("dataPath");
  if ( !dataPath ) {
    console.error(chalk.red(`No dataPath configured. Call ${chalk.yellow("`configure set dataPath <path>`")} first.`));
    return;
  }
  const modules = readPackageManifests(dataPath, "Module", { verbose: argv.verbose });
  const systems = readPackageManifests(dataPath, "System", { verbose: argv.verbose });
  const worlds = readPackageManifests(dataPath, "World", { verbose: argv.verbose });
  return { modules, systems, worlds, packages: [...modules.values(), ...systems.values(), ...worlds.values()] };
}

/* -------------------------------------------- */

/**
 * Determine the document type of an NeDB database from the command-line arguments, if specified, or from the database's
 * containing package.
 * @param {string} packFile  The path to the NeDB database.
 * @param {CLIArgs} argv     The command-line arguments.
 * @returns {string|void}    The document type of the NeDB database if it could be determined.
 */
function determineDocumentType(packFile, argv) {
  // Case 1 - The document type has been explicitly provided.
  if ( argv.compendiumType ) return argv.compendiumType;

  // Case 2 - The type can be inferred from the pack name.
  const packName = path.basename(packFile, ".db");
  for ( const [type, collection] of Object.entries(TYPE_COLLECTION_MAP) ) {
    if ( packName === collection ) return type;
  }

  // Case 3 - Attempt to locate this pack's metadata in the manifest of the package that owns it.
  const game = discoverPackageDirectory(argv);
  const pkg = game.packages.find(p => packFile.startsWith(path.dirname(p.path)));
  const pack = pkg?.packs.find(pack => path.resolve(path.dirname(pkg.path), pack.path) === packFile);
  if ( !pack ) {
    console.error(`Unable to determine document type for NeDB compendium at '${packFile}'. `
      + "Set this manually with -t <type>.");
    return;
  }
  return pack.type ?? pack.entity;
}

/* -------------------------------------------- */

/**
 * Determines whether a file is locked by another process
 * @param {string} filepath  The file path to test.
 * @returns {boolean}
 */
function isFileLocked(filepath) {
  try {
    // Try to open the file with the 'w' flag, which requests write access
    const fd = fs.openSync(filepath, 'w');

    // If the file was successfully opened, it is not locked
    fs.closeSync(fd);
    return false;
  } catch ( err ) {
    if ( err.code === "EBUSY" ) return true;        // If the file could not be opened, it is locked
    else if ( err.code === "ENOENT" ) return false; // If the file can't be found it's not locked
    throw err;
  }
}

/* -------------------------------------------- */

/**
 * @typedef {object} OperationPaths
 * @property {string} source  The source data files.
 * @property {string} pack    The path to the compendium pack.
 */

/**
 * Determine compendium pack and source data paths based on the current configuration or command-line arguments.
 * @param {CLIArgs} argv               The command-line arguments.
 * @param {"pack"|"unpack"} operation  The operation.
 * @returns {OperationPaths|{}}        The paths required for the operation, or nothing if they could not be determined.
 */
function determinePaths(argv, operation) {
  const usingDefault = !argv.outputDirectory || !argv.inputDirectory;
  if ( usingDefault && (!currentPackageId || !currentPackageType) ) {
    console.error("Package ID or type could not be determined. Use `package workon <id>` to set it.");
    return {};
  }

  const dataPath = Config.instance.get("dataPath");
  if ( usingDefault && !dataPath ) {
    console.error("No dataPath configured. Use `configure set dataPath <path>` to set it.");
    return {};
  }

  const typeDir = `${currentPackageType.toLowerCase()}s`;
  const compendiumName = argv.compendiumName ?? argv.value;
  if ( !compendiumName ) {
    console.error("No compendium name provided. Use `-n <name>` to supply it.");
    return {};
  }

  let pack = operation === "pack" ? argv.outputDirectory : argv.inputDirectory;
  let source = operation === "pack" ? argv.inputDirectory : argv.outputDirectory;
  if ( pack ) pack = path.join(pack, compendiumName);
  else pack = path.join(dataPath, "Data", typeDir, currentPackageId, "packs", compendiumName);
  source ??= path.join(pack, "_source");
  if ( argv.nedb ) pack += ".db";
  return { source: path.resolve(path.normalize(source)), pack: path.resolve(path.normalize(pack)) };
}

/* -------------------------------------------- */

/**
 * @callback HierarchyApplyCallback
 * @param {object} doc              The Document being operated on.
 * @param {string} collection       The Document's collection.
 * @param {object} [options]        Additional options supplied by the invocation on the level above this one.
 * @returns {Promise<object|void>}  Options to supply to the next level of the hierarchy.
 */

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
 * @callback HierarchyMapCallback
 * @param {any} entry          The element stored in the collection.
 * @param {string} collection  The collection name.
 * @returns {Promise<any>}
 */

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
/*  Workon                                      */
/* -------------------------------------------- */

/**
 * Set the current package ID and type
 * @param {CLIArgs} argv  The command line arguments
 */
function handleWorkon(argv) {
  if ( argv.value ) currentPackageId = argv.value;
  Config.instance.set("currentPackageId", currentPackageId);

  // Attempt to automatically determine the package type.
  if ( !argv.type ) {
    const game = discoverPackageDirectory(argv);
    const pkgCount = game.packages.filter(p => p.id === currentPackageId).length;
    if ( pkgCount > 1 ) {
      console.error(chalk.red(`Multiple packages with ID ${chalk.cyan(currentPackageId)} found. `
        + `Please specify the package type with ${chalk.yellow("--type")}`));
      process.exitCode = 1;
      return;
    }
    const pkg = game.worlds.get(currentPackageId)
      ?? game.systems.get(currentPackageId)
      ?? game.modules.get(currentPackageId);
    if ( !pkg ) {
      console.error(chalk.red(`No package with ID ${chalk.cyan(currentPackageId)} found.`));
      process.exitCode = 1;
      return;
    }
    currentPackageType = pkg.type;
  }

  Config.instance.set("currentPackageType", currentPackageType);
  console.log(`Swapped to ${chalk.magenta(currentPackageType)} ${chalk.cyan(currentPackageId)}`);
}

/* -------------------------------------------- */

/**
 * Clear the current package ID and type
 */
function handleClear() {
  currentPackageId = null;
  currentPackageType = null;
  Config.instance.set("currentPackageId", currentPackageId);
  Config.instance.set("currentPackageType", currentPackageType);
  console.log("Cleared current Package");
}

/* -------------------------------------------- */
/*  Unpacking                                   */
/* -------------------------------------------- */

/**
 * Load a compendium pack and serialize the DB entries, each to their own file
 * @param {CLIArgs} argv  The command line arguments
 * @returns {Promise<void>}
 */
async function handleUnpack(argv) {
  const { source, pack } = determinePaths(argv, "unpack");
  if ( !source || !pack ) {
    process.exitCode = 1;
    return;
  }

  if ( !argv.nedb && isFileLocked(path.join(pack, "LOCK")) ) {
    console.error(chalk.red(`The pack "${chalk.blue(pack)}" is currently in use by Foundry VTT. `
      + "Please close Foundry VTT and try again."));
    process.exitCode = 1;
    return;
  }

  // Create the output directory if it doesn't exist already.
  fs.mkdirSync(source, { recursive: true });

  const dbMode = argv.nedb ? "nedb" : "classic-level";
  console.log(`[${dbMode}] Unpacking "${chalk.blue(pack)}" to "${chalk.blue(source)}"`);

  try {
    if ( argv.nedb ) await unpackNedb(pack, source, argv);
    else await unpackClassicLevel(pack, source, argv);
  } catch ( err ) {
    console.error(err);
    process.exitCode = 1;
  }
}

/* -------------------------------------------- */

/**
 * Load a NeDB compendium pack file and serialize the DB entries, each to their own file
 * @param {string} pack       The directory path to the pack
 * @param {string} outputDir  The directory path to write the serialized files
 * @param {CLIArgs} argv      The command-line arguments.
 * @returns {Promise<void>}
 */
async function unpackNedb(pack, outputDir, argv) {
  // Load the NeDB file.
  const db = new Datastore({ filename: pack, autoload: true });
  const documentType = determineDocumentType(pack, argv);
  if ( !documentType ) {
    process.exitCode = 1;
    return;
  }

  const unpackDoc = applyHierarchy((doc, collection, { sublevelPrefix, idPrefix }={}) => {
    const sublevel = keyJoin(sublevelPrefix, collection);
    const id = keyJoin(idPrefix, doc._id);
    doc._key = `!${sublevel}!${id}`;
    return { sublevelPrefix: sublevel, idPrefix: id };
  });

  // Iterate over all entries in the db, writing them as individual files
  const docs = await db.find({});
  for ( const doc of docs ) {
    const name = doc.name ? `${getSafeFilename(doc.name)}_${doc._id}` : doc._id;
    await unpackDoc(doc, TYPE_COLLECTION_MAP[documentType]);
    let fileName;
    if ( argv.yaml ) {
      fileName = path.join(outputDir, `${name}.yml`);
      fs.writeFileSync(fileName, yaml.dump(doc));
    } else {
      fileName = path.join(outputDir, `${name}.json`);
      fs.writeFileSync(fileName, JSON.stringify(doc, null, 2) + "\n");
    }
    console.log(`Wrote ${chalk.blue(fileName)}`);
  }
}

/* -------------------------------------------- */

/**
 * Load a Classic Level database and serialize the DB entries, each to their own file
 * @param {string} packDir    The directory path to the pack
 * @param {string} outputDir  The directory path to write the serialized files
 * @param {CLIArgs} argv      The command line arguments
 * @returns {Promise<void>}
 */
async function unpackClassicLevel(packDir, outputDir, argv) {
  // Load the directory as a ClassicLevel db
  const db = new ClassicLevel(packDir, { keyEncoding: "utf8", valueEncoding: "json" });

  const unpackDoc = applyHierarchy(async (doc, collection, { sublevelPrefix, idPrefix }={}) => {
    const sublevel = keyJoin(sublevelPrefix, collection);
    const id = keyJoin(idPrefix, doc._id);
    doc._key = `!${sublevel}!${id}`;
    await mapHierarchy(doc, collection, (embeddedId, embeddedCollectionName) => {
      return db.get(`!${sublevel}.${embeddedCollectionName}!${id}.${embeddedId}`);
    });
    return { sublevelPrefix: sublevel, idPrefix: id };
  });

  // Iterate over all entries in the db, writing them as individual files
  for await ( const [key, doc] of db.iterator() ) {
    const [, collection, id] = key.split("!");
    if ( collection.includes(".") ) continue; // This is not a primary document, skip it.
    const name = doc.name ? `${getSafeFilename(doc.name)}_${id}` : key;
    await unpackDoc(doc, collection);
    let fileName;
    if ( argv.yaml ) {
      fileName = path.join(outputDir, `${name}.yml`);
      fs.writeFileSync(fileName, yaml.dump(doc));
    } else {
      fileName = path.join(outputDir, `${name}.json`);
      fs.writeFileSync(fileName, JSON.stringify(doc, null, 2) + "\n");
    }
    console.log(`Wrote ${chalk.blue(fileName)}`);
  }

  await db.close();
}

/* -------------------------------------------- */
/*  Packing                                     */
/* -------------------------------------------- */

/**
 * Read serialized files from a directory and write them to a compendium pack.
 * @param {CLIArgs} argv  The command line arguments
 * @returns {Promise<void>}
 * @private
 */
async function handlePack(argv) {
  const { source, pack } = determinePaths(argv, "pack");
  if ( !source || !pack ) {
    process.exitCode = 1;
    return;
  }

  if ( !argv.nedb && isFileLocked(path.join(pack, "LOCK")) ) {
    console.error(chalk.red(`The pack "${chalk.blue(pack)}" is currently in use by Foundry VTT. `
      + "Please close Foundry VTT and try again."));
    process.exitCode = 1;
    return;
  }

  // Create the classic level directory if it doesn't exist already
  if ( !argv.nedb ) fs.mkdirSync(pack, { recursive: true });

  const dbMode = argv.nedb ? "nedb" : "classic-level";
  console.log(`[${dbMode}] Packing "${chalk.blue(source)}" into "${chalk.blue(pack)}"`);

  try {
    if ( argv.nedb ) await packNedb(pack, source);
    else await packClassicLevel(pack, source);
  } catch ( err ) {
    console.error(err);
    process.exitCode = 1;
  }
}

/* -------------------------------------------- */

/**
 * Read serialized files from a directory and write them to a NeDB file.
 * @param {string} pack      The directory path to the pack
 * @param {string} inputDir  The directory path to read the serialized files from
 * @returns {Promise<void>}
 * @throws Error             If any file failed to be serialized.
 */
async function packNedb(pack, inputDir) {
  // Delete the existing NeDB file if it exists.
  try {
    fs.unlinkSync(pack);
  } catch ( err ) {
    if ( err.code !== 'ENOENT' ) throw err;
  }

  // Create a new NeDB Datastore.
  const db = Datastore.create(pack);
  const packDoc = applyHierarchy(doc => delete doc._key);

  // Iterate over all files in the input directory, writing them to the DB.
  for ( const file of fs.readdirSync(inputDir) ) {
    try {
      const fileContents = fs.readFileSync(path.join(inputDir, file));
      const doc = file.endsWith(".yml") ? yaml.load(fileContents) : JSON.parse(fileContents);
      const key = doc._key;
      const [, collection] = key.split("!");
      // If the key starts with !folders, we should skip packing it as nedb doesn't support folders
      if ( key.startsWith("!folders") ) continue;
      await packDoc(doc, collection);
      await db.insert(doc);
      console.log(`Packed ${chalk.blue(doc._id)}${chalk.blue(doc.name ? ` (${doc.name})` : "")}`);
    } catch ( err ) {
      console.error(`Failed to parse ${chalk.red(file)}. See error below.`);
      throw err;
    }
  }

  // Compact the database
  db.stopAutocompaction();
  await new Promise(resolve => db.compactDatafile(resolve));
}

/* -------------------------------------------- */

/**
 * Read serialized files from a directory and write them to a Classic Level database.
 * @param {string} packDir   The directory path to the pack
 * @param {string} inputDir  The directory path to read the serialized files from
 * @returns {Promise<void>}
 * @throws Error             If any file failed to be serialized.
 */
async function packClassicLevel(packDir, inputDir) {
  // Load the directory as a ClassicLevel DB.
  const db = new ClassicLevel(packDir, { keyEncoding: "utf8", valueEncoding: "json" });
  const batch = db.batch();
  const seenKeys = new Set();

  const packDoc = applyHierarchy(async (doc, collection) => {
    const key = doc._key;
    delete doc._key;
    seenKeys.add(key);
    const value = structuredClone(doc);
    await mapHierarchy(value, collection, d => d._id);
    batch.put(key, value);
  });

  // Iterate over all files in the input directory, writing them to the DB.
  for ( const file of fs.readdirSync(inputDir) ) {
    try {
      const fileContents = fs.readFileSync(path.join(inputDir, file));
      const doc = file.endsWith(".yml") ? yaml.load(fileContents) : JSON.parse(fileContents);
      const [, collection] = doc._key.split("!");
      await packDoc(doc, collection);
      console.log(`Packed ${chalk.blue(doc._id)}${chalk.blue(doc.name ? ` (${doc.name})` : "")}`);
    } catch ( err ) {
      console.error(`Failed to parse ${chalk.red(file)}. See error below.`);
      throw err;
    }
  }

  // Remove any entries in the db that are not in the input directory
  for ( const key of await db.keys().all() ) {
    if ( !seenKeys.has(key) ) {
      batch.del(key);
      console.log(`Removed ${chalk.blue(key)}`);
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
