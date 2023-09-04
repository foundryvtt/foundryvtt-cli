## 1.0.0-rc.4

### Fixes
 - Fixed issues with packing/unpacking as YAML.

## 1.0.0-rc.3

### Improvements
 - (phenomen) Added cyrillic characters to the set of filesystem-safe characters that a Document name can be written as.
 - Factored out `extractPack` and `compilePack` functionality into an external API.

## 1.0.0-rc.2

### Fixes
 - (DJ4ddi) Fixed path name resolution on Windows.
 - Fixed compendium name not being appropriately appended to --in or --out options depending on operation.

### Improvements
 - (DJ4ddi) Added minimum node engine version.
 - (DJ4ddi) Re-throw parse errors to provide stack trace output in the console.

## 1.0.0-rc.1

### Fixes
 - (DJ4ddi) Log more specific errors when an operation fails.
 - (DJ4ddi) Compress LevelDB after packing it.
 - Fixed NeDB operations throwing a TypeError.

### Breaking Changes
 - (DJ4ddi) Renamed `--inputDirectory` shorthand option from `--id` to `--in` to fix conflict with package ID `--id` option.
 - Renamed `--outputDirectory` shorthand option from `--od` to `--out` to better align with the above change.
 - NeDB unpack operations now write source data to the same directory as LevelDB unpack operations by default (`packs/{compendiumName}/_source`). This fixes an issue whereby sequential NeDB unpack operations would mix all their output together into the same `packs/_source` directory, and allows for better inter-operability with LevelDB operations.
 - Corresponding to the above change, NeDB pack operations by default will look for source files under `packs/{compendiumName}/_source` instead of `packs/_source`.
 - Unpack operations are now consistent between NeDB and LevelDB: Both will unpack primary Document entries to a single file, with all embedded Documents included, rather than LevelDB unpack operations writing every embedded Document to its own file.

### Improvements
 - Improved JSDoc annotations across the project.
 - Improved NeDB document type inference to check the manifest of the package the compendium belongs to rather than searching all packages for a compendium with a matching name.
 - The CLI should be slightly better-behaved and exit with a non-zero error code if it does encounter an error in most cases.
 - When writing JSON files, a newline character is appended to the end of the file to make it more git-friendly.

### Miscellaneous
 - Removed IDE-specific project data from git tracking.
 - Refactored codebase to conform with Foundry VTT code style guidelines.
 - Added .editorconfig and .eslintrc.json to enforce code style.
 - Added .npmignore to strip development-only files from final NPM package.
