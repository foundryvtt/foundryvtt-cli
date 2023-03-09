import fs from "fs";
import yaml from "js-yaml";

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
        this.#config = yaml.load(fs.readFileSync("./config.yml", "utf8"));
    }

    /* -------------------------------------------- */

    #config = {};

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
        fs.writeFileSync("./config.yml", yaml.dump(this.#config));
    }
}
