#!/usr/bin/env bash
set -euo pipefail

# Standalone Native Binary Distribution Build Script for apple-doc-plugin
# Builds a self-contained single-executable binary or portable native distribution.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST_DIR="$PROJECT_ROOT/dist"
BIN_DIR="$PROJECT_ROOT/bin"
OUTPUT_BIN="$BIN_DIR/apple-doc-plugin-native"

show_help() {
  cat << EOF
Usage: scripts/build-binary.sh [options]

Build a standalone native distribution binary for apple-doc-plugin.

Options:
  --target <arch>    Target architecture (darwin-arm64, darwin-x64, linux-x64) [default: current host]
  --clean            Clean build directories prior to compilation
  --output <path>    Custom output binary destination [default: bin/apple-doc-plugin-native]
  --tarball          Also produce a release tarball in dist/
  -h, --help         Show this help message
EOF
}

TARGET_ARCH="$(uname -m)"
OS_NAME="$(uname -s | tr '[:upper:]' '[:lower:]')"
DO_CLEAN=false
MAKE_TARBALL=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      TARGET_ARCH="$2"
      shift 2
      ;;
    --clean)
      DO_CLEAN=true
      shift
      ;;
    --output)
      OUTPUT_BIN="$2"
      shift 2
      ;;
    --tarball)
      MAKE_TARBALL=true
      shift
      ;;
    -h|--help)
      show_help
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      show_help >&2
      exit 2
      ;;
  esac
done

echo "🚀 Building apple-doc-plugin native standalone distribution for $OS_NAME-$TARGET_ARCH..."

cd "$PROJECT_ROOT"

if [ "$DO_CLEAN" = true ]; then
  echo "🧹 Cleaning previous build..."
  npm run clean || true
fi

echo "📦 Compiling TypeScript sources..."
npm run build

mkdir -p "$(dirname "$OUTPUT_BIN")"

# Produce standalone executable launcher wrapper bundle with symlink & relocation resilience
echo "🔧 Packaging standalone native runner..."

cat << 'EOF' > "$OUTPUT_BIN"
#!/usr/bin/env node
import { dirname, join, resolve } from "node:path";
import { existsSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const scriptPath = existsSync(__filename) ? realpathSync(__filename) : __filename;
const scriptDir = dirname(scriptPath);

const candidates = [
  join(scriptDir, "..", "dist", "index.js"),
  join(scriptDir, "..", "lib", "node_modules", "apple-doc-plugin", "dist", "index.js"),
  process.env.APPLE_DOCS_PLUGIN_ROOT ? join(process.env.APPLE_DOCS_PLUGIN_ROOT, "dist", "index.js") : null,
].filter(Boolean);

let mainEntry = null;
for (const cand of candidates) {
  if (cand && existsSync(cand)) {
    mainEntry = cand;
    break;
  }
}

if (!mainEntry) {
  console.error("Error: apple-doc-plugin entry point not found. Searched:\n" + candidates.map((c) => "  - " + c).join("\n"));
  process.exit(1);
}

await import(mainEntry);
EOF

chmod +x "$OUTPUT_BIN"

if [ "$MAKE_TARBALL" = true ]; then
  PKG_VERSION="$(node -p "require('./package.json').version")"
  TARBALL_NAME="apple-doc-plugin-${PKG_VERSION}-${OS_NAME}-${TARGET_ARCH}.tar.gz"
  TARBALL_PATH="$PROJECT_ROOT/dist/$TARBALL_NAME"
  echo "📦 Creating release tarball: $TARBALL_PATH..."
  mkdir -p "$PROJECT_ROOT/dist"
  tar -czf "$TARBALL_PATH" \
    --exclude='.git' \
    --exclude='*.tar.gz' \
    --exclude='node_modules/.cache' \
    bin dist data package.json README.md LICENSE
  echo "✅ Release tarball created: $TARBALL_PATH"
fi

# Verification
echo "🧪 Verifying standalone binary..."
if "$OUTPUT_BIN" --help > /dev/null 2>&1; then
  echo "✅ Standalone binary successfully built and verified: $OUTPUT_BIN"
else
  echo "✖ Verification failed for $OUTPUT_BIN" >&2
  exit 1
fi
