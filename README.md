# foundryvtt-cli
The official Foundry VTT CLI

## Installation
```bash
npm install -g @foundryvtt/foundryvtt-cli
```

## Usage
### Help
```bash
fvtt --help
```

### Current CLI Version
```bash
fvtt --version
```

### Configuration
```bash
fvtt configure
```
Determines if your configuration is correct and if not, prompts you to fix it.

#### View
```bash
fvtt configure view
```

View your current configuration.


#### Set
```bash
fvtt configure set "key" "value"
```

Set a configuration value.

#### Get
```bash
fvtt configure get "key"
```

Get a configuration value.

#### Path
```bash
fvtt configure path
```
Outputs the path to your configuration file.

### Launch

```bash
fvtt launch
```
Launches Foundry VTT. Available options are:
* `--demo` - Launches Foundry VTT in demo mode.
* `--port 30000` - Launches Foundry VTT on a specific port.
* `--world my-world` - Launches Foundry VTT straight into a specific world.
* `--noupnp` - Disable UPnP port forwarding.
* `--noupdate` - Disable automatic update checking.
* `--adminKey "ABC123"` - The admin key to secure Foundry VTT's Setup screen with.

### Package

```bash
fvtt package
```
Output the current working package, if any.

#### Workon
```bash
fvtt package workon "1001-fish" --type "Module"
```
Swaps to working on a specific package, eliminating the need to pass `--type` and `--id` to other package commands.

#### Clear
```bash
fvtt package clear
```
Clears the current working package.

#### Unpack
```bash
fvtt package unpack "compendiumName"
```
Reads a database from the current Package /packs/ directory and writes each document as a serialized Object to its own file.
There are a number of options available to customize the output, check out `fvtt package unpack --help` for more information.

If you run this command in the terminal, it should output what new files were written or updated. For example:
```bash
Unpacking "foundrydatav11/Data/modules/mymodule/packs/myitems" to "git/mymodule/jsons/myitems"
Wrote My_Item_Name_hPLXDSGyHzlupBS2.json
```

#### Pack
```bash
fvtt package pack "compendiumName"
```

Reads a directory of serialized Objects and writes them to a database in the current Package /packs/ directory. There are a number of options available to customize the operation, check out `fvtt package pack --help` for more information.

If you run this command in the terminal, it should output what new files were written or updated. For example:
```bash
Packing "git/mymodule/jsons/myitems" into "git/mymodule/packs/myitems"
Packed hPLXDSGyHzlupBS2 (My Item Name)
```

#### Subdirectories and Modules
You can create subdirectories for your packs directory. For example, in a module, the module.json could define an items pack for two distinct systems:
```json
"packs":[
    {
      "name": "mymodule_items_sfrpg",
      "label": "MyModule Items",
      "path": "packs/items/sfrpg",
      "type": "Item",
      "private": false,
      "system": "sfrpg"
    },
    {
      "name": "mymodule_items_pf2e",
      "label": "MyModule Items",
      "path": "packs/items/pf2e",
      "type": "Item",
      "private": false,
      "system": "pf2e"
    }
]
```
In the Foundry Data folder, this will create the following folder hierarchy:
`Data/modules/mymodule/packs/items/sfrpg/` and `Data/modules/mymodule/packs/items/pf2e/`.

To unpack and pack these, use the path you defined for the compendium name. For example, to extract jsons to a folder in your home directory:
```bash
fvtt package unpack -n "items/pf2e" --outputDirectory "~/jsons/items/pf2e"
fvtt package unpack -n "items/sfrpg" --outputDirectory "~/jsons/items/sfrpg"
```
To pack them using subdirectories:
```bash
fvtt package pack -n "items/pf2e" --inputDirectory "~/jsons/items/pf2e" --outputDirectory "packs"
fvtt package pack -n "items/sfrpg" --inputDirectory "~/jsons/items/sfrpg" --outputDirectory "packs"
```

## Example Workflow

```bash
fvtt configure
fvtt package workon "1001-fish"
fvtt package unpack "fish"
. . . // Make some updates to the files
fvtt package pack "fish"
```

## Development
```bash
git clone
cd foundryvtt-cli
npm install
npm run build
npm link
```

## API

Certain internal functionality of the CLI is exposed as an API that can be imported into other projects.

### Example Usage

```js
import { compilePack, extractPack } from "@foundryvtt/foundryvtt-cli";

// Extract a NeDB compendium pack.
await extractpack("mymodule/packs/actors.db", "mymodule/packs/src/actors", { nedb: true });

// Compile a LevelDB compendium pack.
await compilePack("mymodule/packs/src/actors", "mymodule/packs/actors");
```

### `compilePack(src: string, dest: string, options?: object): Promise<void>`

Compile source files into a compendium pack.

#### Parameters

* **src:** *string* The directory containing the source files.
* **dest:** *string* The target compendium pack.
* **options:** *object*
  * **nedb:** *boolean = false* Whether to operate on a NeDB database, otherwise a LevelDB database is assumed.
  * **yaml:** *boolean = false* Whether the source files are in YAML format, otherwise JSON is assumed.
  * **log:** *boolean = false* Whether to log operation progress to the console.
  * **recursive:** *boolean = false* Whether to recurse into child directories under **src**, otherwise only source files located directly under **src** will be used.
  * **transformEntry:** *(entry: object): Promise<false|void>* A function that is called on every entry. Returning *false* indicates that the entry should be discarded.

### `extractPack(src: string, dest: string, options?: object): Promise<void>`

Extract the contents of a compendium pack into individual source files for each primary Document.

#### Parameters

* **src:** *string* The source compendium pack.
* **dest:** *string* The directory to write the extracted files into.
* **options:** *object*
    * **nedb:** *boolean = false* Whether to operate on a NeDB database, otherwise a LevelDB database is assumed.
    * **yaml:** *boolean = false* Whether the source files are in YAML format, otherwise JSON is assumed.
    * **yamlOptions:** *object = {}* Options to pass to `yaml.dump` when serializing Documents.
    * **log:** *boolean = false* Whether to log operation progress to the console.
    * **folders:** *boolean = false* Create a directory structure that matches the pack's Folder documents. Folder documents are written to their matching directory with the name `_Folder.{yml|json}`.
    * **documentType:** *string* For NeDB operations, a **documentType** must be provided. This should be the same as the pack's *type* field in the *module.json* or *system.json*.
    * **transformEntry:** *(entry: object): Promise<false|void>* A function that is called on every entry. Returning *false* indicates that the entry should be discarded.
    * **transformName:** *(entry: object): Promise<string|void>* A function that is called on every entry. The value returned from this will be used as the entry's filename and must include the appropriate file extension. If nothing is returned, an auto-generated name will be used instead.
    * **transformFolderName:** *(entry: object): Promise<string|void>* A function used to generate a directory name for an extracted Folder document when the `folders` option is used.
    * **expandAdventures:** *boolean* Write documents emebdded in Adventures to their own files. If the `folders` option is also supplied, the Adventure is treated like a folder, and written to `_Adventure.{yml|json}` instead of `_Folder.{yml|json}`.
    * **jsonOptions:** *object*
        * **replacer:** *(key: string, value: any): any|Array<string|number>* A replacer function or an array of property names in the object to include in the resulting string.
        * **space:** *string|number* A number of spaces or a string to use as indentation.

## Contributing
Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.
