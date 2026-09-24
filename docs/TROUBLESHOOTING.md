# Troubleshooting Native Addon Build

`better-sqlite3` is a compiled C++ native addon. If `npm install` fails with `node-gyp` or compiler errors, your system is missing native build tools. This is a local compilation requirement, not an MCP protocol bug.

### macOS

Install the Xcode Command Line Tools:

```bash
xcode-select --install
```

### Debian / Ubuntu

Install standard C++ build utilities and Python:

```bash
sudo apt-get update
sudo apt-get install -y build-essential python3
```

### Fedora / RHEL

```bash
sudo dnf groupinstall "Development Tools"
```

### Verification

Once build tools are installed, rebuild the module:

```bash
npm rebuild better-sqlite3
```
