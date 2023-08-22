#!/usr/bin/env node

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { getCommand as configureCommand } from "./commands/configuration.mjs";
import { getCommand as packageCommand } from "./commands/package.mjs";
import { getCommand as launchCommand } from "./commands/launch.mjs";

const argv = yargs(hideBin(process.argv))
  .usage("Usage: $0 <command> [options]")
  .command(configureCommand())
  .command(packageCommand())
  .command(launchCommand())
  .help().alias("help", "h")
  .argv;
