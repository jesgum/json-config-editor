## Building from source

### Prerequisites
- [Node.js](https://nodejs.org) v20 or newer
- [vsce](https://github.com/microsoft/vscode-vsce): `npm install -g @vscode/vsce`

### Build
```bash
git clone https://github.com/jesgum/json-config-editor.git
cd json-config-editor
npm install
npm run compile
vsce package

### Install
```bash
code --install-extension json-config-editor-*.vsix