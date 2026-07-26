# JSON Config Editor

A VS Code extension for viewing large, nested JSON files in a structured tree view instead of a flat text editor.

## Features
- Open JSON files in a visual tree-based editor
- Explore nested objects and arrays more easily
- Keep the workflow focused on configuration files and structured data

## Usage
1. Open a JSON file in VS Code.
2. Run the command "Open JSON Config Editor" from the Command Palette or the editor title bar.
3. Browse the content in the tree view.

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

## License
MIT

Disclaimer: Everything in this project is created by AI.