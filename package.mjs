import Datastore from "nedb-promises";
import yaml from "js-yaml";
import chalk from "chalk";
import {ClassicLevel} from "classic-level";
import path from "path";
import fs from "fs";

export default class Package {

    /* -------------------------------------------- */

    /**
     * Replace all non-alphanumeric characters with an underscore in a filename
     * @param {string} filename         The filename to sanitize
     * @returns {string}                The sanitized filename
     */
    static #getSafeFilename(filename) {
        return filename.replace(/[^a-zA-Z0-9]/g, '_');
    }

    /* -------------------------------------------- */

    /**
     * Normalize a path to use POSIX separators
     * @param {string} pathToNormalize      The path to normalize
     * @returns {string}
     */
    static normalizePath(pathToNormalize) {
        return path.normalize(pathToNormalize).split(path.sep).join(path.posix.sep);
    }

    /* -------------------------------------------- */

    /**
     * Discover the list of all Packages in the dataPath
     * @param {string} dataPath      The path to the data directory
     * @returns {Object}             An object containing discovered packages
     */
    static discoverPackageDirectory(dataPath, verbose=false) {
        const modulesDir = Package.normalizePath(`${dataPath}/Data/modules`);
        const systemsDir = Package.normalizePath(`${dataPath}/Data/systems`);
        const worldsDir = Package.normalizePath(`${dataPath}/Data/worlds`);

        const game = {
            modules: new Map(),
            systems: new Map(),
            worlds: new Map(),
            packages: new Map()
        };

        // For each dir, find all subdirectories and their system.json, module.json, or world.json
        for ( const module of fs.readdirSync(modulesDir, {withFileTypes: true}) ) {
            // Find the module.json file
            const modulePath = Package.normalizePath(`${modulesDir}/${module.name}/module.json`);
            if ( fs.existsSync(modulePath) ) {
                // Read the module.json file
                try {
                    const moduleData = JSON.parse(fs.readFileSync(modulePath, "utf8"));
                    moduleData.type = "Module";
                    game.modules.set(moduleData.id ?? moduleData.name, moduleData);
                }
                catch (e) {
                    if ( verbose ) console.error(chalk.red(`Error reading module.json for ${chalk.blue(module.name)}: ${e}`));
                }
            }
        }
        for ( const system of fs.readdirSync(systemsDir, {withFileTypes: true}) ) {
            // Find the system.json file
            const systemPath = Package.normalizePath(`${systemsDir}/${system.name}/system.json`);
            if ( fs.existsSync(systemPath) ) {
                // Read the system.json file
                try {
                    const systemData = JSON.parse(fs.readFileSync(systemPath, "utf8"));
                    systemData.type = "System";
                    game.systems.set(systemData.id ?? systemData.name, systemData);
                }
                catch (e) {
                    if ( verbose ) console.error(chalk.red(`Error reading system.json for ${chalk.blue(system.name)}: ${e}`));
                }
            }
        }
        for ( const world of fs.readdirSync(worldsDir, {withFileTypes: true}) ) {
            // Find the world.json file
            const worldPath = Package.normalizePath(`${worldsDir}/${world.name}/world.json`);
            if ( fs.existsSync(worldPath) ) {
                // Read the world.json file
                try {
                    const worldData = JSON.parse(fs.readFileSync(worldPath, "utf8"));
                    worldData.type = "World";
                    game.worlds.set(worldData.id ?? worldData.name, worldData);
                }
                catch (e) {
                    if ( verbose ) console.error(chalk.red(`Error reading world.json for ${chalk.blue(world.name)}: ${e}`));
                }
            }
        }

        game.packages = [...game.modules, ...game.systems, ...game.worlds];

        return game;
    }

    /* -------------------------------------------- */

    /**
     * Load a pack from a directory and serialize the DB entries, each to their own file
     * @param {string} packDir          The directory path to the pack
     * @param {string} outputDir        The directory path to write the serialized files
     * @param {string} dataPath         The path to the data directory
     * @param {string} compendiumName   The name of the compendium
     * @param {boolean} useYaml         Whether to use YAML instead of JSON
     * @returns {Promise<void>}
     */
    static async unpackNedb(packDir, outputDir, dataPath, compendiumName, useYaml=false) {
        // Load the directory as a Nedb
        const db = new Datastore({
            filename: `${packDir}/${compendiumName}.db`,
            autoload: true
        });

        // Iterate over all entries in the db, writing them as individual YAML files
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
            const game = Package.discoverPackageDirectory(dataPath);

            // Get all packs from world, system, and modules
            const packs = [...game.modules, ...game.systems, ...game.worlds].map(p => p.packs).flat();

            // Find the pack with the matching name
            const pack = packs.find(p => p.name === compendiumName);
            if ( pack ) {
                documentType = pack.type ?? pack.entity;
            }
        }

        const docs = await db.find({});
        for (const doc of docs) {
            const name = doc.name ? `${doc.name.toLowerCase().replaceAll(" ", "_")}_${doc._id}` : doc._id;
            doc._key = `!${documentType}!${doc._id}`;
            let fileName;
            if ( useYaml ) {
                fileName = Package.#getSafeFilename(`${outputDir}/${name}.yml`);
                fs.writeFileSync(fileName, yaml.dump(doc));
            }
            else {
                fileName = Package.#getSafeFilename(`${outputDir}/${name}.json`);
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
     * @param {boolean} useYaml         Whether to use YAML instead of JSON for the output files
     * @returns {Promise<void>}
     */
    static async unpackClassicLevel(packDir, outputDir, useYaml=false) {
        // Load the directory as a ClassicLevel db
        const db = new ClassicLevel(packDir, {keyEncoding: "utf8", valueEncoding: "json"});
        const keys = await db.keys().all();

        // Iterate over all entries in the db, writing them as individual YAML files
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, {recursive: true});
        }
        for await (const [key, value] of db.iterator()) {
            const name = value.name ? `${value.name.toLowerCase().replaceAll(" ", "_")}_${value._id}` : key;
            value._key = key;
            let fileName;
            if ( useYaml ) {
                fileName = Package.#getSafeFilename(`${outputDir}/${name}.yml`);
                fs.writeFileSync(fileName, yaml.dump(value));
            }
            else {
                fileName = Package.#getSafeFilename(`${outputDir}/${name}.json`);
                fs.writeFileSync(fileName, JSON.stringify(value, null, 2));
            }
            console.log(`Wrote ${chalk.blue(fileName)}`);
        }

        await db.close();
    }

    /* -------------------------------------------- */

    /**
     * Read serialized files from a directory and write them to a pack db
     * @param {string} packDir              The directory path to the pack
     * @param {string} inputDir             The directory path to read the serialized files from
     * @param {string} compendiumName       The name of the compendium
     * @returns {Promise<void>}
     */
    static async packNedb(packDir, inputDir, compendiumName) {
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
            db.once("compaction.done", resolve);
            db.compactDatafile();
        });
    }

    /* -------------------------------------------- */

    /**
     * Read serialized files from a directory and write them to a pack db
     * @param {string} packDir        The directory path to the pack
     * @param {string} inputDir       The directory path to read the serialized files from
     * @returns {Promise<void>}
     */
    static async packClassicLevel(packDir, inputDir) {
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
