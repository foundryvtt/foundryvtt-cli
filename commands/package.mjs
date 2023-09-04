import Config from "../config.mjs";
import path from "path";
import fs from "fs";
import chalk from "chalk";
import { compilePack, extractPack, TYPE_COLLECTION_MAP } from "../lib/package.mjs";

/**
 * @typedef {"Module"|"System"|"World"} PackageType
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

  let documentType;
  const { nedb, yaml } = argv;
  if ( nedb ) {
    documentType = determineDocumentType(pack, argv);
    if ( !documentType ) {
      process.exitCode = 1;
      return;
    }
  }

  if ( !nedb && isFileLocked(path.join(pack, "LOCK")) ) {
    console.error(chalk.red(`The pack "${chalk.blue(pack)}" is currently in use by Foundry VTT. `
      + "Please close Foundry VTT and try again."));
    process.exitCode = 1;
    return;
  }

  const dbMode = nedb ? "nedb" : "classic-level";
  console.log(`[${dbMode}] Unpacking "${chalk.blue(pack)}" to "${chalk.blue(source)}"`);

  try {
    await extractPack(pack, source, { nedb, yaml, documentType, log: true });
  } catch ( err ) {
    console.error(err);
    process.exitCode = 1;
  }
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

  const { nedb, yaml } = argv;
  if ( !nedb && isFileLocked(path.join(pack, "LOCK")) ) {
    console.error(chalk.red(`The pack "${chalk.blue(pack)}" is currently in use by Foundry VTT. `
      + "Please close Foundry VTT and try again."));
    process.exitCode = 1;
    return;
  }

  const dbMode = nedb ? "nedb" : "classic-level";
  console.log(`[${dbMode}] Packing "${chalk.blue(source)}" into "${chalk.blue(pack)}"`);

  try {
    await compilePack(source, pack, { nedb, yaml, log: true });
  } catch ( err ) {
    console.error(err);
    process.exitCode = 1;
  }
}
