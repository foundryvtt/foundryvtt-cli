import fs from "fs";
import yaml from "js-yaml";
import path from "path";

/**
 * Manages the configuration of the CLI. Stored as config.yml
 */
export default class Config {

    static #instance = null;

    /* -------------------------------------------- */

    /**
     * Get the singleton instance of the Config class
     * @returns {Config}
     */
    static get instance() {
        if (!this.#instance) {
            this.#instance = new Config();
        }
        return this.#instance;
    }

    /* -------------------------------------------- */

    constructor() {

        // Set the config file path to the appData directory
        this.configPath = path.join(process.env.APPDATA ?? process.env.HOME, "config.yml");

        // Ensure the config file exists
        if (!fs.existsSync(this.configPath)) {
            fs.writeFileSync(this.configPath, yaml.dump({}));
        }
        this.#config = yaml.load(fs.readFileSync(this.configPath, "utf8"));
    }

    /* -------------------------------------------- */

    #config = {};

    configPath = "";

    /* -------------------------------------------- */

    /**
     * Get the entire configuration object
     * @returns {Map<string, *>}
     */
    getAll() {
        return this.#config;
    }

    /* -------------------------------------------- */

    /**
     * Get a specific configuration value
     * @param {string} key      The configuration key
     * @returns {*}
     */
    get(key) {
        return this.#config[key];
    }

    /* -------------------------------------------- */

    /**
     * Set a specific configuration value
     * @param {string} key      The configuration key
     * @param {*} value         The configuration value
     */
    set(key, value) {
        this.#config[key] = value;

        // Write to disk
        this.#writeConfig();
    }

    /* -------------------------------------------- */

    /**
     * Write the configuration to disk
     */
    #writeConfig() {
        fs.writeFileSync(this.configPath, yaml.dump(this.#config));
    }
}
