import Config from "../config.mjs";
import { spawn } from "child_process";
import path from "path";
import * as fs from 'fs';

/**
 * Get the command object for the launch command
 * @returns {CommandModule}
 */
export function getCommand() {
  return {
    command: "launch",
    describe: "Launch Foundry VTT",
    builder: yargs => {
      yargs.option("demo", {
        describe: "Launch Foundry VTT in demo mode",
        type: "boolean",
        default: false
      });

      yargs.option("port", {
        describe: "The port to launch Foundry VTT on",
        type: "number",
        default: 30000
      });

      yargs.option("world", {
        describe: "The world to launch Foundry VTT with",
        type: "string"
      });

      yargs.option("noupnp", {
        describe: "Disable UPnP port forwarding",
        type: "boolean",
        default: false
      });

      yargs.option("noupdate", {
        describe: "Disable automatic update checking",
        type: "boolean",
        default: false
      });

      yargs.option("adminKey", {
        describe: "The admin key to secure Foundry VTT's Setup screen with",
        type: "string"
      });

      return yargs;
    },
    handler: async argv => {

      // Run the command node main.js --debug --port 30000
      // Launch Foundry VTT in debug mode on port 30000
      const { demo, port, world, noupnp, noupdate, adminKey } = argv;

      // Determine the installation path
      const installPath = Config.instance.get("installPath");
      if ( !installPath ) {
        console.error("The installation path is not set. Use `configure set installPath <path>` to set it. "
          + "Install paths look like `C:/Program Files/Foundry Virtual Tabletop`");
        process.exitCode = 1;
        return;
      }

      // Determine the data path
      const dataPath = Config.instance.get("dataPath");
      if ( !dataPath ) {
        console.error("The data path is not set. Use `configure set dataPath <path>` to set it. "
          + "Data paths look like `C:/Users/Example/AppData/Local/FoundryVTT/Data`");
        process.exitCode = 1;
        return;
      }

      // Figure out if we are running the fvtt application or nodejs version
      let fvttPath = path.normalize(path.join(installPath, "resources", "app", "main.js")); 
      try {
        await fs.promises.stat(fvttPath)
      } catch (error) {
        // try to use the nodejs path instead
        fvttPath = path.normalize(path.join(installPath, "main.js"));
      }

      // If we still don't have access to the main.js file then error out
      try {
        await fs.promises.stat(fvttPath);
      } catch (error) {
        console.error("Unable to find the main.js file under the installPath: %s\n Error: %s", installPath, error)
        process.exitCode = 1;
        return;
      }

      // Launch Foundry VTT
      const foundry = spawn("node", [
        fvttPath,
        `--dataPath=${dataPath}`,
        `--port=${port}`,
        demo ? "--demo" : "",
        world ? `--world=${world}` : "",
        noupnp ? "--noupnp" : "",
        noupdate ? "--noupdate" : "",
        adminKey ? `--adminKey=${adminKey}` : ""
      ]);

      foundry.stdout.on("data", data => console.log(data.toString()));
      foundry.stderr.on("data", data => console.error(data.toString()));
      foundry.on("close", code => console.log(`Foundry VTT exited with code ${code}`));
    }
  }
}
