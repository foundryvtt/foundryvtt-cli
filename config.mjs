import fs from "fs";
import yaml from "js-yaml";
import path from "path";
import * as os from "os";

/**
 * Manages the configuration of the CLI. Stored as config.yml
 */
export default class Config {

  /**
   * The singleton instance.
   * @type {Config|null}
   */
  static #instance = null;

  /* -------------------------------------------- */

  /**
   * Get the singleton instance of the Config class
   * @returns {Config}
   */
  static get instance() {
    if ( !this.#instance ) this.#instance = new Config();
    return this.#instance;
  }

  /* -------------------------------------------- */

  constructor() {

    // Set the config file path to the appData directory
    let basePath = os.homedir();
    switch ( process.platform ) {
      case "win32": basePath = process.env.APPDATA || path.join(basePath, "AppData", "Roaming"); break;
      case "darwin": basePath = path.join(basePath, "Library", "Preferences"); break;
      case "linux": basePath = process.env.XDG_DATA_HOME || path.join(basePath, ".local", "share"); break;
    }

    fs.mkdirSync(basePath, { recursive: true });
    this.configPath = path.join(basePath, ".fvttrc.yml");

    // Ensure the config file exists
    if ( !fs.existsSync(this.configPath) ) fs.writeFileSync(this.configPath, yaml.dump({}));
    this.#config = yaml.load(fs.readFileSync(this.configPath, "utf8"));
  }

  /* -------------------------------------------- */

  /**
   * The configuration data.
   * @type {Record<string, any>}
   */
  #config = {};

  /* -------------------------------------------- */

  /**
   * The path to the configuration file.
   * @type {string}
   */
  configPath = "";

  /* -------------------------------------------- */

  /**
   * Get the entire configuration object
   * @returns {Record<string, any>}
   */
  getAll() {
    return this.#config;
  }

  /* -------------------------------------------- */

  /**
   * Get a specific configuration value
   * @param {string} key      The configuration key
   * @returns {any}
   */
  get(key) {
    return this.#config[key];
  }

  /* -------------------------------------------- */

  /**
   * Set a specific configuration value
   * @param {string} key      The configuration key
   * @param {any} value       The configuration value
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
