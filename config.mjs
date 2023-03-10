import fs from "fs";
import yaml from "js-yaml";
import path from "path";

/**
 * Manages the configuration of the CLI. Stored as config.yml
 */
export default class Config {

    static #instance = null;

    /* -------------------------------------------- */

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

    getAll() {
        return this.#config;
    }

    /* -------------------------------------------- */

    get(key) {
        return this.#config[key];
    }

    /* -------------------------------------------- */

    set(key, value) {
        this.#config[key] = value;

        // Write to disk
        this.#writeConfig();
    }

    /* -------------------------------------------- */

    #writeConfig() {
        // Write to disk
        fs.writeFileSync(this.configPath, yaml.dump(this.#config));
    }
}
