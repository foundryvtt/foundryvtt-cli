import Config from "../config.mjs";
import yaml from "js-yaml";
import fs from "fs";
import chalk from 'chalk';
import Package from "../package.mjs";

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
                alias: "id",
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
     * Discover the list of all Packages in the dataPath
     * @param {Object} argv      The command line arguments
     * @returns {Object}         An object containing discovered packages
     */
    function discoverPackageDirectory(argv) {
        const dataPath = Config.instance.get("dataPath");
        if ( !dataPath ) {
            console.error(chalk.red(`No dataPath configured. Call ${chalk.yellow("`configure set dataPath <path>`")} first.`));
            return;
        }
        return Package.discoverPackageDirectory(dataPath, argv.verbose);
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
        let typeDir = ""
        if ( usingDefaultDirectory ) {
            typeDir = currentPackageType.toLowerCase() + "s";
            if (!currentPackageId) {
                console.error(chalk.red("No package ID is currently set. Use `package workon <id>` to set it."));
                return;
            }
        }
        const compendiumName = argv.compendiumName ?? argv.value;
        if ( !compendiumName && ( dbMode === "nedb" || usingDefaultDirectory)) {
            console.error("No Compendium Name provided for the `unpack` action. Try again with `-n <name>`.");
            return;
        }

        const dataPath = Config.instance.get("dataPath");
        if ( !dataPath && usingDefaultDirectory) {
            console.error(chalk.red("No dataPath configured. Call `configure set dataPath <path>` first."));
            return;
        }

        let packDir = Package.normalizePath(argv.inputDirectory ?? `${dataPath}/Data/${typeDir}/${currentPackageId}/packs`);
        if ( dbMode === "classic-level" ) packDir += `/${compendiumName}`;
        const outputDir = Package.normalizePath(argv.outputDirectory ?? `${packDir}/_source`);

        if ( (dbMode === "classic-level") && isFileLocked( packDir + "/LOCK") ) {
            console.error(chalk.red(`The pack "${chalk.blue(packDir)}" is currently in use by Foundry VTT. Please close Foundry VTT and try again.`));
            return;
        }

        console.log(`[${dbMode}] Writing pack ${chalk.blue(compendiumName)} from "${chalk.blue(packDir)}" to "${chalk.blue(outputDir)}"`);

        try {
            if ( dbMode === "nedb" ) {
                await Package.unpackNedb(packDir, outputDir, dataPath, compendiumName, argv.yaml);
            }
            else {
                await Package.unpackClassicLevel(packDir, outputDir, argv.yaml);
            }
        }
        catch (err) {
            console.error(err);
        }
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
        let typeDir = ""
        if ( usingDefaultDirectory ) {
            typeDir = currentPackageType.toLowerCase() + "s";
            if (!currentPackageId) {
                console.error(chalk.red("No package ID is currently set. Use `package workon <id>` to set it."));
                return;
            }
        }

        const compendiumName = argv.compendiumName ?? argv.value;
        if ( !compendiumName && ( dbMode === "nedb" || usingDefaultDirectory) ) {
            console.error(chalk.red(`No Compendium Name provided for the ${chalk.yellow(`pack`)} action. Try again with ${chalk.yellow(`-n <name>`)}.`));
            return;
        }

        const dataPath = Config.instance.get("dataPath");
        if ( !dataPath && usingDefaultDirectory) {
            console.error(chalk.red(`No dataPath configured. Call ${chalk.yellow(`configure set dataPath <path>`)} first.`));
            return;
        }
        let packDir = Package.normalizePath(argv.outputDirectory ?? `${dataPath}/Data/${typeDir}/${currentPackageId}/packs`);
        if ( dbMode === "classic-level" ) packDir += `/${compendiumName}`;
        const inputDir = Package.normalizePath(argv.inputDirectory ?? `${packDir}/_source`);

        if ( (dbMode === "classic-level") && isFileLocked( packDir + "/LOCK") ) {
            console.error(chalk.red(`The pack "${chalk.blue(packDir)}" is currently in use by Foundry VTT. Please close Foundry VTT and try again.`));
            return;
        }

        console.log(`[${dbMode}] Packing ${chalk.blue(compendiumName)} from "${chalk.blue(inputDir)}" into "${chalk.blue(packDir)}"`);

        try {
            if ( dbMode === "nedb" ) {
                await Package.packNedb(packDir, inputDir, compendiumName);
            }
            else {
                await Package.packClassicLevel(packDir, inputDir);
            }
        }
        catch (err) {
            console.error(chalk.red(err));
        }
    }
}
