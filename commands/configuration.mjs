import Config from "../config.mjs";

/**
 * Get the command object for the configuration command
 * @returns {CommandModule}
 */
export function getCommand() {
  return {
    command: "configure [action] [key] [value]",
    describe: "Manage configuration",
    builder: yargs => {
      yargs.positional("action", {
        describe: "The action to perform",
        type: "string",
        choices: ["get", "set", "path", "view"]
      }).positional("key", {
        describe: "The configuration key",
        type: "string"
      }).positional("value", {
        describe: "The configuration value",
        type: "string"
      });
      return yargs;
    },
    handler: async argv => {

      // Handle actions
      switch ( argv.action ) {
        case "get": {
          console.log(Config.instance.get(argv.key));
          break;
        }

        case "set": {
          Config.instance.set(argv.key, argv.value);
          console.log(`Set ${argv.key} to ${argv.value}`);
          break;
        }

        case "view": {
          // Output the current configuration
          console.log("Current Configuration:", Config.instance.getAll());
          break;
        }

        case "path": {
          // Output the current configuration file path
          console.log("Current Configuration File:", Config.instance.configPath);
          break;
        }

        default: {
          // Determine if the dataPath and installPath are set
          const installPath = Config.instance.get("installPath");
          if ( !installPath ) {
            console.error("The installation path is not set. Use `configure set installPath <path>` to set it. "
              + "Install paths look like `C:/Program Files/Foundry Virtual Tabletop`");
          }

          const dataPath = Config.instance.get("dataPath");
          if ( !dataPath ) {
            console.error("The data path is not set. Use `configure set dataPath <path>` to set it. "
              + "Data paths look like `C:/Users/Example/AppData/Local/FoundryVTT`");
          }

          // If both are set, configuration is complete
          if ( installPath && dataPath ) console.log("Configuration complete!");
        }
      }
    }
  }
}
