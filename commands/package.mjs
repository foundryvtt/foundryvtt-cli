import Config from "../config.mjs";
import {ClassicLevel} from "classic-level";
import yaml from "js-yaml";
import path from "path";
import fs from "fs";
import chalk from 'chalk';
import Datastore from "nedb-promises";

/**
 * Get the command object for the package command
 * @returns {{handler: ((function(*): Promise<void>)|*), builder: builder, describe: string, command: string}}
 */
export function getCommand() {
    let currentPackageId = Config.instance.get("currentPackageId");
    let currentPackageType = Config.instance.get("currentPackageType");

    return {
        command: "package [action] [value]",
        describe: "Manage packages",
        builder: (yargs) => {
            yargs.positional("action", {
                describe: "The action to perform",
                type: "string",
                choices: ["workon", "clear", "unpack", "pack"]
            });

            yargs.positional("value", {
                describe: "The value to use for the action",
                type: "string"
            });

            // currentPackageId is only needed, if the data path has to be built with it.
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

            yargs.option("inputDirectory", {
                alias: "in",
                describe: "The directory to read from, for Pack based Actions.",
                type: "string"
            });

            yargs.option("outputDirectory", {
                alias: "od",
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
        },
        handler: async (argv) => {
            if ( argv.id ) {
                currentPackageId = argv.id;
            }
            if ( argv.type ) {
                currentPackageType = argv.type;
            }

            // Handle actions
            switch ( argv.action ) {
                case "workon": {
                    _handleWorkon(argv);
                    break;
                }

                case "clear": {
                    _handleClear();
                    break;
                }

                case "unpack": {
                    await _handleUnpack(argv);
                    break;
                }

                case "pack": {
                    await _handlePack(argv);
                    break;
                }

                default: {
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

    /**
     * Set the current package ID and type
     * @param {Object} argv                  The command line arguments
     * @private
     */
    function _handleWorkon(argv) {
        if ( argv.value ) {
            currentPackageId = argv.value;
        }
        Config.instance.set("currentPackageId", currentPackageId);

        if ( !argv.type ) {
            const game = discoverPackageDirectory(argv);
            const pkgCount = game.packages.filter(p => p[0] === currentPackageId).length;
            if ( pkgCount > 1 ) {
                console.error(chalk.red(`Multiple packages with ID ${chalk.cyan(currentPackageId)} found. Please specify the package type with ${chalk.yellow("--type")}`));
                return;
            }
            const pkg = game.worlds.get(currentPackageId) ?? game.systems.get(currentPackageId) ?? game.modules.get(currentPackageId);
            if ( !pkg ) {
                console.error(chalk.red(`No package with ID ${chalk.cyan(currentPackageId)} found.`));
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
     * @private
     */
    function _handleClear() {
        currentPackageId = null;
        currentPackageType = null;
        Config.instance.set("currentPackageId", currentPackageId);
        Config.instance.set("currentPackageType", currentPackageType);
        console.log("Cleared current Package");
    }

    /* -------------------------------------------- */

    /**
     * Normalize a path to use POSIX separators
     * @param {string} pathToNormalize      The path to normalize
     * @returns {string}
     */
    function normalizePath(pathToNormalize) {
        return path.normalize(pathToNormalize).split(path.sep).join(path.posix.sep);
    }

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
     * Discover the list of all Packages in the dataPath
     * @param {Object} argv                  The command line arguments
     * @returns {*}
     */
    function discoverPackageDirectory(argv) {
        const dataPath = Config.instance.get("dataPath");
        if ( !dataPath ) {
            console.error(chalk.red(`No dataPath configured. Call ${chalk.yellow("`configure set dataPath <path>`")} first.`));
            return;
        }

        const modulesDir = normalizePath(`${dataPath}/Data/modules`);
        const systemsDir = normalizePath(`${dataPath}/Data/systems`);
        const worldsDir = normalizePath(`${dataPath}/Data/worlds`);

        const game = {
            modules: new Map(),
            systems: new Map(),
            worlds: new Map(),
            packages: new Map()
        };

        // For each dir, find all subdirectories and their system.json, module.json, or world.json
        for ( const module of fs.readdirSync(modulesDir, {withFileTypes: true}) ) {
            // Find the module.json file
            const modulePath = normalizePath(`${modulesDir}/${module.name}/module.json`);
            if ( fs.existsSync(modulePath) ) {
                // Read the module.json file
                try {
                    const moduleData = JSON.parse(fs.readFileSync(modulePath, "utf8"));
                    moduleData.type = "Module";
                    game.modules.set(moduleData.id ?? moduleData.name, moduleData);
                }
                catch (e) {
                    if ( argv.verbose ) console.error(chalk.red(`Error reading module.json for ${chalk.blue(module.name)}: ${e}`));
                }
            }
        }
        for ( const system of fs.readdirSync(systemsDir, {withFileTypes: true}) ) {
            // Find the system.json file
            const systemPath = normalizePath(`${systemsDir}/${system.name}/system.json`);
            if ( fs.existsSync(systemPath) ) {
                // Read the system.json file
                try {
                    const systemData = JSON.parse(fs.readFileSync(systemPath, "utf8"));
                    systemData.type = "System";
                    game.systems.set(systemData.id ?? systemData.name, systemData);
                }
                catch (e) {
                    if ( argv.verbose ) console.error(chalk.red(`Error reading system.json for ${chalk.blue(system.name)}: ${e}`));
                }
            }
        }
        for ( const world of fs.readdirSync(worldsDir, {withFileTypes: true}) ) {
            // Find the world.json file
            const worldPath = normalizePath(`${worldsDir}/${world.name}/world.json`);
            if ( fs.existsSync(worldPath) ) {
                // Read the world.json file
                try {
                    const worldData = JSON.parse(fs.readFileSync(worldPath, "utf8"));
                    worldData.type = "World";
                    game.worlds.set(worldData.id ?? worldData.name, worldData);
                }
                catch (e) {
                    if ( argv.verbose ) console.error(chalk.red(`Error reading world.json for ${chalk.blue(world.name)}: ${e}`));
                }
            }
        }

        game.packages = [...game.modules, ...game.systems, ...game.worlds];

        return game;
    }

    /* -------------------------------------------- */

    /**
     * Determines whether a file is locked by another process
     * @param {string} filepath
     * @returns {boolean}
     */
    function isFileLocked(filepath) {
        try {
            // Try to open the file with the 'w' flag, which requests write access
            const fd = fs.openSync(filepath, 'w');

            // If the file was successfully opened, it is not locked
            fs.closeSync(fd);
            return false;
        } catch (err) {
            // If the file could not be opened, it is locked
            if (err.code === 'EBUSY') {
                return true;
            // If the file can't be found it's not locked
            } else if (err.code === 'ENOENT') {
                return false;
            } else {
                throw err;
            }
        }
    }

    /* -------------------------------------------- */

    /**
     * Load a pack from a directory and serialize the DB entries, each to their own file
     * @param {Object} argv                  The command line arguments
     * @returns {Promise<void>}
     * @private
     */
    async function _handleUnpack(argv) {
        const dbMode = argv.nedb ? "nedb" : "classic-level";
        const usingDefaultDirectory = (!argv.outputDirectory || !argv.inputDirectory);
        const typeDir = usingDefaultDirectory ? currentPackageType.toLowerCase() + "s" : "";
        if (usingDefaultDirectory) {
            if (!currentPackageId) {
                console.error(chalk.red("No package ID is currently set. Use `package workon <id>` to set it."));
                return;
            }
        }
        const compendiumName = argv.compendiumName ?? argv.value;
        if ( !compendiumName ) {
            console.error("No Compendium Name provided for the `unpack` action. Try again with `-n <name>`.");
            return;
        }

        const dataPath = Config.instance.get("dataPath");
        if ( !dataPath && usingDefaultDirectory) {
            console.error(chalk.red("No dataPath configured. Call `configure set dataPath <path>` first."));
            return;
        }

        let packDir = normalizePath(argv.inputDirectory ?? `${dataPath}/Data/${typeDir}/${currentPackageId}/packs`);
        if ( dbMode === "classic-level" ) packDir += `/${compendiumName}`;
        const outputDir = normalizePath(argv.outputDirectory ?? `${packDir}/_source`);

        if ( (dbMode === "classic-level") && isFileLocked( packDir + "/LOCK") ) {
            console.error(chalk.red(`The pack "${chalk.blue(packDir)}" is currently in use by Foundry VTT. Please close Foundry VTT and try again.`));
            return;
        }

        console.log(`[${dbMode}] Writing pack ${chalk.blue(compendiumName)} from "${chalk.blue(packDir)}" to "${chalk.blue(outputDir)}"`);

        try {
            if ( dbMode === "nedb" ) {
                await _unpackNedb(packDir, outputDir, argv, compendiumName);
            }
            else {
                await _unpackClassicLevel(packDir, outputDir, argv);
            }
        }
        catch (err) {
            console.error(err);
        }
    }

    /* -------------------------------------------- */

    /**
     * Load a pack from a directory and serialize the DB entries, each to their own file
     * @param {string} packDir          The directory path to the pack
     * @param {string} outputDir        The directory path to write the serialized files
     * @param {Object} argv             The command line arguments
     * @param {string} compendiumName   The name of the compendium
     * @returns {Promise<void>}
     * @private
     */
    async function _unpackNedb(packDir, outputDir, argv, compendiumName) {
        // Load the directory as a Nedb
        const db = new Datastore({
            filename: `${packDir}/${compendiumName}.db`,
            autoload: true
        });
        // Create output folder
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, {recursive: true});
        }
        
        // Load package manifests
        let documentType = "Unknown";
        
        const knownWorldTypes = [ "actors", "cards", "combats", "drawings", "fog", "folders", "items",
        "journal", "macros", "messages", "playlists", "scenes", "tables" ];
        
        if ( knownWorldTypes.includes(compendiumName) ) {
            documentType = compendiumName;
        }
        else {
            const game = discoverPackageDirectory(argv);
            // Get all packs from world, system, and modules
            const packs = [...game.modules, ...game.systems, ...game.worlds].map(p => p.packs).flat();
            // Find the pack with the matching name
            const pack = packs.find(p => p.name === compendiumName);
            if ( pack ) {
                documentType = pack.type ?? pack.entity;
            }
        }
        
        // Iterate over all entries in the db, writing them as individual YAML files
        const docs = await db.find({});
        for (const doc of docs) {
            const name = doc.name ? `${getSafeFilename(doc.name)}_${doc._id}` : doc._id;
            doc._key = `!${documentType}!${doc._id}`;
            let fileName;
            if ( argv.yaml ) {
                fileName = `${outputDir}/${name}.yml`;
                fs.writeFileSync(fileName, yaml.dump(doc));
            }
            else {
                fileName = `${outputDir}/${name}.json`;
                fs.writeFileSync(fileName, JSON.stringify(doc, null, 2));
            }
            console.log(`Wrote ${chalk.blue(fileName)}`);
        }
    }

    /* -------------------------------------------- */

    /**
     * Load a pack from a directory and serialize the DB entries, each to their own file
     * @param {string} packDir          The directory path to the pack
     * @param {string} outputDir        The directory path to write the serialized files
     * @param {Object} argv             The command line arguments
     * @returns {Promise<void>}
     * @private
     */
    async function _unpackClassicLevel(packDir, outputDir, argv) {
        // Load the directory as a ClassicLevel db
        const db = new ClassicLevel(packDir, {keyEncoding: "utf8", valueEncoding: "json"});
        const keys = await db.keys().all();

        // Create output folder
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, {recursive: true});
        }
        // Iterate over all entries in the db, writing them as individual YAML files
        for await (const [key, value] of db.iterator()) {
            const name = value.name ? `${getSafeFilename(value.name)}_${value._id}` : key;
            value._key = key;
            let fileName;
            if ( argv.yaml ) {
                fileName = `${outputDir}/${name}.yml`;
                fs.writeFileSync(fileName, yaml.dump(value));
            }
            else {
                fileName = `${outputDir}/${name}.json`;
                fs.writeFileSync(fileName, JSON.stringify(value, null, 2));
            }
            console.log(`Wrote ${chalk.blue(fileName)}`);
        }

        await db.close();
    }

    /* -------------------------------------------- */

    /**
     * Read serialized files from a directory and write them to a pack db
     * @param {Object} argv                  The command line arguments
     * @returns {Promise<void>}
     * @private
     */
    async function _handlePack(argv) {
        const dbMode = argv.nedb ? "nedb" : "classic-level";
        const usingDefaultDirectory = (!argv.outputDirectory || !argv.inputDirectory);
        const typeDir = usingDefaultDirectory ? currentPackageType.toLowerCase() + "s" : "";
        if (usingDefaultDirectory) {
            if (!currentPackageId) {
                console.error(chalk.red("No package ID is currently set. Use `package workon <id>` to set it."));
                return;
            }
        }

        const compendiumName = argv.compendiumName ?? argv.value;
        if ( !compendiumName  ) {
            console.error(chalk.red(`No Compendium Name provided for the ${chalk.yellow(`pack`)} action. Try again with ${chalk.yellow(`-n <name>`)}.`));
            return;
        }

        const dataPath = Config.instance.get("dataPath");
        if ( !dataPath && usingDefaultDirectory) {
            console.error(chalk.red(`No dataPath configured. Call ${chalk.yellow(`configure set dataPath <path>`)} first.`));
            return;
        }
        let packDir = normalizePath(argv.outputDirectory ?? `${dataPath}/Data/${typeDir}/${currentPackageId}/packs`);
        if ( dbMode === "classic-level" ) packDir += `/${compendiumName}`;
        const inputDir = normalizePath(argv.inputDirectory ?? `${packDir}/_source`);

        if ( (dbMode === "classic-level") && isFileLocked( packDir + "/LOCK") ) {
            console.error(chalk.red(`The pack "${chalk.blue(packDir)}" is currently in use by Foundry VTT. Please close Foundry VTT and try again.`));
            return;
        }
        
        // Create packDir if it doesn't exist already
        if (!fs.existsSync(packDir)) {
            fs.mkdirSync(packDir, {recursive: true});
        }

        console.log(`[${dbMode}] Packing ${chalk.blue(compendiumName)} from "${chalk.blue(inputDir)}" into "${chalk.blue(packDir)}"`);

        try {
            if ( dbMode === "nedb" ) {
                await _packNedb(packDir, inputDir, compendiumName);
            }
            else {
                await _packClassicLevel(packDir, inputDir);
            }
        }
        catch (err) {
            console.error(chalk.red(err));
        }
    }

    /* -------------------------------------------- */

    /**
     * Read serialized files from a directory and write them to a pack db
     * @param {string} packDir              The directory path to the pack
     * @param {string} inputDir             The directory path to read the serialized files from
     * @param {string} compendiumName       The name of the compendium
     * @returns {Promise<void>}
     * @private
     */
    async function _packNedb(packDir, inputDir, compendiumName) {
        // Load the directory as a Nedb
        const db = Datastore.create(`${packDir}/${compendiumName}.db`);

        // Iterate over all YAML files in the input directory, writing them to the db
        const files = fs.readdirSync(inputDir);
        const seenKeys = new Set();
        for ( const file of files ) {
            const fileContents = fs.readFileSync(path.join(inputDir, file));
            const value = file.endsWith(".yml") ? yaml.load(fileContents) : JSON.parse(fileContents);
            const key = value._key;
            // If the key starts with !folders, we should skip packing it as nedb doesn't support folders
            if ( key.startsWith("!folders") ) continue;

            delete value._key;
            seenKeys.add(value._id);

            // If key already exists, update it
            const existing = await db.findOne({_id: value._id});
            if ( existing ) {
                await db.update({_id: key}, value);
                console.log(`Updated ${chalk.blue(value._id)}${chalk.blue(value.name ? ` (${value.name})` : "")}`);
            }
            else {
                await db.insert(value);
                console.log(`Packed ${chalk.blue(value._id)}${chalk.blue(value.name ? ` (${value.name})` : "")}`);
            }
        }

        // Remove any entries which were not updated
        const docs = await db.find({_id: {$nin: Array.from(seenKeys)}})
        for ( const doc of docs ) {
            await db.remove({_id: doc._id}, {});
            console.log(`Removed ${chalk.blue(doc._id)}${chalk.blue(doc.name ? ` (${doc.name})` : "")}`);
        }

        // Compact the database
        db.stopAutocompaction();
        await new Promise(resolve => {
            db.compactDatafile(resolve);
        });
    }

    /* -------------------------------------------- */

    /**
     * Read serialized files from a directory and write them to a pack db
     * @param {string} packDir        The directory path to the pack
     * @param {string} inputDir       The directory path to read the serialized files from
     * @returns {Promise<void>}
     * @private
     */
    async function _packClassicLevel(packDir, inputDir) {
        // Load the directory as a ClassicLevel db
        const db = new ClassicLevel(packDir, {keyEncoding: "utf8", valueEncoding: "json"});
        const batch = db.batch();

        // Iterate over all YAML files in the input directory, writing them to the db
        const files = fs.readdirSync(inputDir);
        const seenKeys = new Set();
        for ( const file of files ) {
            const fileContents = fs.readFileSync(path.join(inputDir, file));
            const value = file.endsWith(".yml") ? yaml.load(fileContents) : JSON.parse(fileContents);
            const key = value._key;
            delete value._key;
            seenKeys.add(key);
            batch.put(key, value);
            console.log(`Packed ${chalk.blue(value._id)}${chalk.blue(value.name ? ` (${value.name})` : "")}`);
        }

        // Remove any entries in the db that are not in the input directory
        for ( const key of await db.keys().all() ) {
            if ( !seenKeys.has(key) ) {
                batch.del(key);
                console.log(`Removed ${chalk.blue(key)}`);
            }
        }
        await batch.write();
        await db.close();
    }
}
