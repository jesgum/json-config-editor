# JSON Config Editor

A VS Code extension for viewing large, nested JSON files in a structured tree view instead of a flat text editor.

## Features
- Open JSON files in a visual tree-based editor
- Explore nested objects and arrays more easily
- Keep the workflow focused on configuration files and structured data
- Compare two JSON files side by side as a tree
- Supports `.json` and `.jsonc` (comments and trailing commas are allowed)
- Edits change only the values you touch: comments, indentation, line endings and the rest of the file are left as they were

## Usage
1. Open a JSON file in VS Code.
2. Run the command "Open JSON Config Editor" from the Command Palette or the editor title bar.
3. Browse the content in the tree view.

### Searching
- Ctrl+F (Cmd+F on macOS) focuses the search box. It matches keys and values at any depth, opens the parents of each match, and hides fields that don't match.
- Enter / Shift+Enter jumps to the next / previous match. Esc clears the search and puts back the folds you had before.
- A query containing `.` is matched against the full path, e.g. `http.timeout` finds `server.http.timeout`.

### Comparing two files
- Right-click a `.json`/`.jsonc` file in the Explorer (or its editor tab) and choose **Select for Compare (JSON Config)**, then right-click a second one and choose **Compare with Selected (JSON Config)**.
- Or select two JSON files in the Explorer and choose **Compare Selected (JSON Config)**.
- The compare view is one tree with the key, then a value column per file. A field only one file has leaves a blank placeholder in the other column.
- Changed values are highlighted on both sides, and added or removed fields are marked. Objects are matched by key, lists by position.
- Both files can be edited right in the compare view, the same way as in the editor: fields, list entries (**−** / **+**), matrix cells, Ctrl+Z / Ctrl+Y. Each edit is saved to the file straight away, unless that file has unsaved changes in another tab; then it is left unsaved there.
- Search (Ctrl+F) looks through both files. **differences only** hides fields that are the same; **swap** switches left and right; click a file name to open it in the editor. The view updates as either file changes.

### Editing notes
- Fields keep their type: editing a number stays a number while the text is a valid number, `true`/`false` stay booleans.
- Lists of simple values show one field per entry: **−** removes an entry, **+** (or Enter in the last field) adds one. New entries take the type of the last entry; an emptied list stays `[]` and can be added to again.
- Numbers too large for JavaScript (beyond ±2^53) are displayed rounded, but are written back exactly unless you edit them.
- Undo/redo (Ctrl+Z / Ctrl+Y) inside the editor is reset when the file is changed elsewhere.

## Installation
### From VSIX
1. Build the extension package:
   ```bash
   npm install
   npm run compile
   npx @vscode/vsce package
   ```
2. Install the generated .vsix file from the Extensions panel in VS Code.

### From source
```bash
git clone https://github.com/jesgum/json-config-editor.git
cd json-config-editor
npm install
npm run compile
```

## Development
- Requires Node.js 20 or newer
- Build with:
  ```bash
  npm run compile
  ```
- Run the unit tests and the linter:
  ```bash
  npm test
  npm run lint
  ```

## License
MIT

Disclaimer: Everything in this project is created by AI.