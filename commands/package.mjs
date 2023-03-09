import Config from "../config.mjs";
import {ClassicLevel} from "classic-level";
import yaml from "js-yaml";
import path from "path";
import fs from "fs";

export function getCommand() {
    let currentPackageId = Config.instance.get("currentPackageId");
    let currentPackageType = Config.instance.get("currentPackageType");

    return {
        command: "package [action]",
        describe: "Manage packages",
        builder: (yargs) => {
            yargs.positional("action", {
                describe: "The action to perform",
                type: "string",
                choices: ["set", "clear", "write", "pack"]
            });

            // If no currentPackageId is set and the action is not "clear", require an `id` option to be set
            yargs.option("id", {
                describe: "The package ID",
                type: "string",
                demandOption: currentPackageId === null,
            });

            yargs.option("type", {
                describe: "The package type",
                type: "string",
                choices: ["Module", "System", "World"],
                demandOption: currentPackageType === null,
            });

            yargs.option("documentName", {
                alias: "n",
                describe: "The document name, for Pack based Actions.",
                type: "string",
                choices: [ "Actor", "Card", "Item", "Journal", "Playlist", "Scene", "Table" ]
            });

            yargs.option("directory", {
                alias: "d",
                describe: "The directory to serialize to / from, for Pack based Actions.",
                type: "string"
            });
        },
        handler: async (argv) => {
            console.log("package handler", argv);

            if ( argv.id ) {
                currentPackageId = argv.id;
            }
            if ( argv.type ) {
                currentPackageType = argv.type;
            }

            // Handle actions
            switch ( argv.action ) {
                case "set": {
                    _handleSet();
                    break;
                }

                case "clear": {
                    _handleClear();
                    break;
                }

                case "write": {
                    await _handleWrite(argv);
                    break;
                }

                case "pack": {
                    await _handlePack(argv);
                    break;
                }

                default: {
                    console.log(`Currently in ${currentPackageType} ${currentPackageId}`);
                    break;
                }
            }
        }
    }

    /* -------------------------------------------- */

    /**
     * Set the current package ID and type
     * @private
     */
    function _handleSet() {
        Config.instance.set("currentPackageId", currentPackageId);
        Config.instance.set("currentPackageType", currentPackageType);
        console.log(`Swapped to ${currentPackageType} ${currentPackageId}`);
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

    function normalizePath(pathToNormalize) {
        return path.normalize(pathToNormalize).split(path.sep).join(path.posix.sep);
    }

    /* -------------------------------------------- */

    /**
     * Load a pack from a directory and write the db entries to YAML files
     * @param argv
     * @returns {Promise<void>}
     * @private
     */
    async function _handleWrite(argv) {
        const typeDir = currentPackageType.toLowerCase() + "s";

        if ( !argv.documentName ) {
            console.error("No documentName provided for the `writePack` action. Try again with `-n <documentName>`.");
            return;
        }

        const documentDir = argv.documentName.toLowerCase() + "s";
        const dataPath = Config.instance.get("dataPath");
        if ( !dataPath ) {
            console.error("No dataPath configured. Call `configure set dataPath <path>` first.");
            return;
        }

        const packDir = normalizePath(`${dataPath}/${typeDir}/${currentPackageId}/data/${documentDir}`);
        const outputDir = normalizePath(`${argv.directory ?? `./${typeDir}/${currentPackageId}`}/${documentDir}`);
        console.log(`Writing pack "${packDir}" to "${outputDir}"`);

        try {
            // Load the directory as a ClassicLevel db
            const db = new ClassicLevel(packDir, {keyEncoding: "utf8", valueEncoding: "json"});

            // Iterate over all entries in the db, writing them as individual YAML files
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, {recursive: true});
            }
            for await (const [key, value] of db.iterator()) {
                const name = value.name ? `${value.name.toLowerCase().replaceAll(" ", "_")}_${value._id}` : key;
                const fileName = `${outputDir}/${name}.yml`;
                ;
                fs.writeFileSync(fileName, yaml.dump(value));
                console.log(`Wrote ${fileName}`);
            }

            await db.close();
        }
        catch (err) {
            console.error(err);
        }
    }

    /* -------------------------------------------- */

    /**
     * Read YAML files from a directory and write them to a pack db
     * @param argv
     * @returns {Promise<void>}
     * @private
     */
    async function _handlePack(argv) {
        const typeDir = currentPackageType.toLowerCase() + "s";

        if ( !argv.documentName ) {
            console.error("No documentName provided for the `writePack` action. Try again with `-n <documentName>`.");
            return;
        }

        const documentDir = argv.documentName.toLowerCase() + "s";
        const dataPath = Config.instance.get("dataPath");
        if ( !dataPath ) {
            console.error("No dataPath configured. Call `configure set dataPath <path>` first.");
            return;
        }
        const packDir = normalizePath(`${dataPath}/${typeDir}/${currentPackageId}/data/${documentDir}`);
        const inputDir = normalizePath(`${argv.directory ?? `./${typeDir}/${currentPackageId}`}/${documentDir}`);
        console.log(`Packing "${inputDir}" into pack "${packDir}"`);

        try {
            // Load the directory as a ClassicLevel db
            const db = new ClassicLevel(packDir, {keyEncoding: "utf8", valueEncoding: "json"});

            // Iterate over all YAML files in the input directory, writing them to the db
            const files = fs.readdirSync(inputDir);
            for ( const file of files ) {
                const value = yaml.load(fs.readFileSync(path.join(inputDir, file)));
                await db.put(value._id, value);
                console.log(`Packed ${value._id}${value.name ? ` (${value.name})` : ""}`);
            }
        }
        catch (err) {
            console.error(err);
        }
    }
}