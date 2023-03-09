import Config from "../config.mjs";

export function getCommand() {
    return {
        command: "configure [action] [key] [value]",
        describe: "Manage configuration",
        builder: (yargs) => {
            yargs.positional("action", {
                describe: "The action to perform",
                type: "string",
                choices: ["get", "set"]
            })
                .positional("key", {
                    describe: "The configuration key",
                    type: "string"
                })
                .positional("value", {
                    describe: "The configuration value",
                    type: "string"
                });
        },
        handler: async (argv) => {
            console.log("configure handler", argv);

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
                default: {
                    // Output the current configuration
                    console.log(Config.instance.getAll());
                    break;
                }
            }
        }
    }
}
