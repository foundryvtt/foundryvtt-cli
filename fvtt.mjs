import yargs from "yargs";
import {hideBin} from "yargs/helpers";
import {getCommand as configureCommand} from "./commands/configuration.mjs";
import {getCommand as packageCommand} from "./commands/package.mjs";

const argv = yargs(hideBin(process.argv))
    .usage("Usage: $0 <command> [options]")
    .command(configureCommand())
    .command(packageCommand())
    .help().alias('help', 'h')
    .argv;
