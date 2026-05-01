# Lucode Development Commands
#
# Run modes:
#   just run              - Dev mode with auto-detected port (hot-reload enabled, FASTEST compile)
#   just run-port 2235    - Release binary on specific port (NO hot-reload) - use for Lucode-on-Lucode
#   just run-port-dev 2235 - Dev mode on specific port (hot-reload enabled, standard dev performance)
#   just run-port-release 2235 - Force rebuild release binary on specific port (NO hot-reload)
#   just run-release      - Run pre-built release binary (NO hot-reload)
#
# Build Profiles:
#   dev (opt-level=0) - Default profile for fastest compilation, used by 'just run' and 'just test'
#   dev-opt (opt-level=3 for deps) - Production-like performance for testing
#   release (opt-level=3) - Used for production builds with maximum optimization
#
# Install modes:
#   just install       - Full release build (slow, maximum optimization) → /Applications
#   just install-fast  - Fast release build (thin LTO, parallel codegen) → /Applications

pm := "node scripts/package-manager.mjs"

# Stamp a calver version (YYYY.MDD.Hmm) into all version files for install builds.
# Saves backups so _restore-version can put them back even with uncommitted changes.
_stamp-calver:
    #!/usr/bin/env bash
    set -euo pipefail
    cp src-tauri/tauri.conf.json src-tauri/tauri.conf.json.bak
    cp src-tauri/Cargo.toml src-tauri/Cargo.toml.bak
    cp package.json package.json.bak
    YEAR=$(date +%Y)
    MONTH_DAY=$(date +%-m%d)
    HOUR_MIN=$((10#$(date +%H%M)))
    VERSION="${YEAR}.${MONTH_DAY}.${HOUR_MIN}"
    echo "Stamping calver: $VERSION"
    sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" src-tauri/tauri.conf.json
    sed -i '' "s/^version = \"[^\"]*\"/version = \"$VERSION\"/" src-tauri/Cargo.toml
    node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.version='${VERSION}';fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n');"

# Restore version files from backups created by _stamp-calver
_restore-version:
    #!/usr/bin/env bash
    set -euo pipefail
    for f in src-tauri/tauri.conf.json src-tauri/Cargo.toml package.json; do
        if [ -f "${f}.bak" ]; then mv "${f}.bak" "$f"; fi
    done

# Clear all caches (build and application)
clear:
    rm -rf node_modules/.vite dist dist-ssr src-tauri/target/debug/incremental src-tauri/target/debug/deps src-tauri/target/debug/build
    rm -rf ~/Library/Application\ Support/lucode/cache ~/Library/Application\ Support/lucode/WebKit ~/.lucode/cache
    rm -rf src-tauri/target/.rustc_info.json src-tauri/target/debug/.fingerprint
    rm -rf ~/Library/Caches/lucode* ~/Library/WebKit/lucode* /tmp/lucode* 2>/dev/null || true
    pkill -f "lucode" || true
    rm -rf .parcel-cache .turbo

# Setup dependencies for development
setup:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "Installing dependencies..."
    {{pm}} install
    # Setup MCP server if it exists
    if [ -d "mcp-server" ]; then
        echo "Setting up MCP server..."
        cd mcp-server
        node ../scripts/package-manager.mjs install
        cd ..
        echo "MCP server dependencies installed"
    fi

    echo "Setup complete! You can now run 'just install' to build and install the app"

# Install the application on macOS (builds and installs to /Applications)
install:
    #!/usr/bin/env bash
    set -euo pipefail

    echo "Building Lucode for macOS..."

    just _stamp-calver
    trap 'just _restore-version' EXIT

    # Check if node_modules exists, if not run setup first
    if [ ! -d "node_modules" ]; then
        echo "Dependencies not found. Running setup first..."
        just setup
    fi

    # Build frontend
    echo "Building frontend..."
    {{pm}} run build
    # Build MCP server if it exists
    if [ -d "mcp-server" ]; then
        echo "Building MCP server..."
        cd mcp-server
        # Ensure clean, reproducible deps before building (dev deps required for tsc)
        echo "Installing MCP server dependencies (lockfile)..."
        node ../scripts/package-manager.mjs install --frozen-lockfile
        # Build TypeScript sources
        node ../scripts/package-manager.mjs run build
        # Re-install with production-only deps for embedding inside the app bundle
        node ../scripts/package-manager.mjs install --production --frozen-lockfile
        cd ..
        echo "MCP server built"
    fi

    # Build Tauri application (app bundle only — DMG/installer built by CI)
    echo "Building Tauri app..."
    {{pm}} run tauri -- build --bundles app
    
    # Find the built app bundle (handle different architectures)
    APP_PATH=""
    if [ -d "src-tauri/target/release/bundle/macos/Lucode.app" ]; then
        APP_PATH="src-tauri/target/release/bundle/macos/Lucode.app"
    elif [ -d "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Lucode.app" ]; then
        APP_PATH="src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Lucode.app"
    elif [ -d "src-tauri/target/x86_64-apple-darwin/release/bundle/macos/Lucode.app" ]; then
        APP_PATH="src-tauri/target/x86_64-apple-darwin/release/bundle/macos/Lucode.app"
    elif [ -d "src-tauri/target/universal-apple-darwin/release/bundle/macos/Lucode.app" ]; then
        APP_PATH="src-tauri/target/universal-apple-darwin/release/bundle/macos/Lucode.app"
    fi
    
    if [ -z "$APP_PATH" ] || [ ! -d "$APP_PATH" ]; then
        echo "Build failed - Lucode.app not found"
        echo "Searched in:"
        echo "  - src-tauri/target/release/bundle/macos/"
        echo "  - src-tauri/target/aarch64-apple-darwin/release/bundle/macos/"
        echo "  - src-tauri/target/x86_64-apple-darwin/release/bundle/macos/"
        echo "  - src-tauri/target/universal-apple-darwin/release/bundle/macos/"
        exit 1
    fi

    echo "Found app bundle at: $APP_PATH"

    # Embed MCP server if it was built
    if [ -d "mcp-server/build" ]; then
        MCP_DIR="$APP_PATH/Contents/Resources/mcp-server"
        mkdir -p "$MCP_DIR"
        cp -R mcp-server/build "$MCP_DIR/"
        cp mcp-server/package.json "$MCP_DIR/"
        cp -R mcp-server/node_modules "$MCP_DIR/"
        echo "MCP server embedded in app bundle"
    fi

    SIGNING_IDENTITY="$(bash scripts/ensure-local-macos-signing-identity.sh)"
    if [ -n "$SIGNING_IDENTITY" ]; then
        echo "Signing Lucode with local identity: $SIGNING_IDENTITY"
        codesign --force --deep --timestamp=none --sign "$SIGNING_IDENTITY" "$APP_PATH"
        codesign --verify --deep --strict "$APP_PATH"
    fi

    # Always install to /Applications for simplicity
    INSTALL_DIR="/Applications"

    # Remove old installation if it exists
    if [ -d "$INSTALL_DIR/Lucode.app" ]; then
        echo "Removing existing Lucode installation..."
        echo "Admin password required to remove old installation"
        sudo rm -rf "$INSTALL_DIR/Lucode.app"
    fi

    # Copy the app to Applications
    echo "Installing Lucode to $INSTALL_DIR..."
    echo "Admin password required for installation"
    sudo cp -R "$APP_PATH" "$INSTALL_DIR/"

    # Set proper permissions
    sudo chmod -R 755 "$INSTALL_DIR/Lucode.app"

    # Clear quarantine attributes to avoid Gatekeeper issues
    sudo xattr -cr "$INSTALL_DIR/Lucode.app" 2>/dev/null || true

    echo "Lucode installed successfully!"
    echo ""
    echo "Launch Lucode:"
    echo "  - From Spotlight: Press Cmd+Space and type 'Lucode'"
    echo "  - From Terminal: open /Applications/Lucode.app"

# Install with fast compilation (thin LTO + parallel codegen instead of full LTO)
install-fast:
    #!/usr/bin/env bash
    set -euo pipefail

    echo "Building Lucode for macOS (fast mode: thin LTO)..."

    just _stamp-calver
    trap 'just _restore-version' EXIT

    # Check if node_modules exists, if not run setup first
    if [ ! -d "node_modules" ]; then
        echo "Dependencies not found. Running setup first..."
        just setup
    fi

    # Build frontend
    echo "Building frontend..."
    {{pm}} run build
    # Build MCP server if it exists
    if [ -d "mcp-server" ]; then
        echo "Building MCP server..."
        cd mcp-server
        # Ensure clean, reproducible deps before building (dev deps required for tsc)
        echo "Installing MCP server dependencies (lockfile)..."
        node ../scripts/package-manager.mjs install --frozen-lockfile
        # Build TypeScript sources
        node ../scripts/package-manager.mjs run build
        # Re-install with production-only deps for embedding inside the app bundle
        node ../scripts/package-manager.mjs install --production --frozen-lockfile
        cd ..
        echo "MCP server built"
    fi

    # Build Tauri application with relaxed release profile for faster compilation
    echo "Building Tauri app (thin LTO, parallel codegen)..."
    CARGO_PROFILE_RELEASE_LTO="thin" \
    CARGO_PROFILE_RELEASE_CODEGEN_UNITS="16" \
    {{pm}} run tauri -- build --bundles app

    # Find the built app bundle (handle different architectures)
    APP_PATH=""
    if [ -d "src-tauri/target/release/bundle/macos/Lucode.app" ]; then
        APP_PATH="src-tauri/target/release/bundle/macos/Lucode.app"
    elif [ -d "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Lucode.app" ]; then
        APP_PATH="src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Lucode.app"
    elif [ -d "src-tauri/target/x86_64-apple-darwin/release/bundle/macos/Lucode.app" ]; then
        APP_PATH="src-tauri/target/x86_64-apple-darwin/release/bundle/macos/Lucode.app"
    elif [ -d "src-tauri/target/universal-apple-darwin/release/bundle/macos/Lucode.app" ]; then
        APP_PATH="src-tauri/target/universal-apple-darwin/release/bundle/macos/Lucode.app"
    fi

    if [ -z "$APP_PATH" ] || [ ! -d "$APP_PATH" ]; then
        echo "Build failed - Lucode.app not found"
        echo "Searched in:"
        echo "  - src-tauri/target/release/bundle/macos/"
        echo "  - src-tauri/target/aarch64-apple-darwin/release/bundle/macos/"
        echo "  - src-tauri/target/x86_64-apple-darwin/release/bundle/macos/"
        echo "  - src-tauri/target/universal-apple-darwin/release/bundle/macos/"
        exit 1
    fi

    echo "Found app bundle at: $APP_PATH"

    # Embed MCP server if it was built
    if [ -d "mcp-server/build" ]; then
        MCP_DIR="$APP_PATH/Contents/Resources/mcp-server"
        mkdir -p "$MCP_DIR"
        cp -R mcp-server/build "$MCP_DIR/"
        cp mcp-server/package.json "$MCP_DIR/"
        cp -R mcp-server/node_modules "$MCP_DIR/"
        echo "MCP server embedded in app bundle"
    fi

    SIGNING_IDENTITY="$(bash scripts/ensure-local-macos-signing-identity.sh)"
    if [ -n "$SIGNING_IDENTITY" ]; then
        echo "Signing Lucode with local identity: $SIGNING_IDENTITY"
        codesign --force --deep --timestamp=none --sign "$SIGNING_IDENTITY" "$APP_PATH"
        codesign --verify --deep --strict "$APP_PATH"
    fi

    # Always install to /Applications for simplicity
    INSTALL_DIR="/Applications"

    # Remove old installation if it exists
    if [ -d "$INSTALL_DIR/Lucode.app" ]; then
        echo "Removing existing Lucode installation..."
        echo "Admin password required to remove old installation"
        sudo rm -rf "$INSTALL_DIR/Lucode.app"
    fi

    # Copy the app to Applications
    echo "Installing Lucode to $INSTALL_DIR..."
    echo "Admin password required for installation"
    sudo cp -R "$APP_PATH" "$INSTALL_DIR/"

    # Set proper permissions
    sudo chmod -R 755 "$INSTALL_DIR/Lucode.app"

    # Clear quarantine attributes to avoid Gatekeeper issues
    sudo xattr -cr "$INSTALL_DIR/Lucode.app" 2>/dev/null || true

    echo "Lucode installed successfully! (fast mode)"
    echo ""
    echo "Launch Lucode:"
    echo "  - From Spotlight: Press Cmd+Space and type 'Lucode'"
    echo "  - From Terminal: open /Applications/Lucode.app"

# Find an available port starting from a base port
_find_available_port base_port:
    #!/usr/bin/env bash
    port={{base_port}}
    while lsof -i :$port >/dev/null 2>&1; do
        port=$((port + 1))
    done
    echo $port

# Run the application in development mode with auto port detection (optimized for FASTEST compilation)
run:
    #!/usr/bin/env bash
    set -euo pipefail

    # Get the directory containing this justfile
    cd "{{justfile_directory()}}"

    # Verify we're in the correct directory
    if [[ ! -f "package.json" ]]; then
        echo "Error: Not in project root directory (no package.json found)"
        echo "Current directory: $(pwd)"
        exit 1
    fi

    echo "Working from project root: $(pwd)"

    # Get current git branch for display
    branch=$(git branch --show-current 2>/dev/null || echo "no-branch")

    # Find available port starting from 1420
    port=$(just _find_available_port 1420)
    echo "Starting Lucode on port $port (branch: $branch)"
    echo "Using dev profile (opt-level=0) for fastest compilation"

    if [[ -z "${CARGO_TARGET_DIR:-}" ]]; then
        export CARGO_TARGET_DIR="$(git rev-parse --git-common-dir)/lucode-target"
    fi
    export CARGO_INCREMENTAL="${CARGO_INCREMENTAL:-1}"
    mkdir -p "$CARGO_TARGET_DIR"

    # Enable all available speed optimizations
    if command -v sccache &> /dev/null; then
        if sccache rustc -vV >/dev/null 2>&1; then
            echo "Using sccache for Rust compilation caching"
            export RUSTC_WRAPPER=sccache
            export SCCACHE_DIR=$HOME/.cache/sccache
        else
            echo "sccache found but unusable; continuing without it"
            export RUSTC_WRAPPER=
            export CARGO_BUILD_RUSTC_WRAPPER=
        fi
    fi
    
    # Export the port for Vite
    export VITE_PORT=$port

    # Signal to the app that it is running via `just run` so it can surface a dev-mode indicator.
    export LUCODE_DEV_MODE=1

    # Create temporary config override for Tauri to use the dynamic port
    temp_config=$(mktemp)
    cat > "$temp_config" <<EOF
    {
      "build": {
        "devUrl": "http://localhost:$port",
        "beforeDevCommand": "node scripts/package-manager.mjs run dev",
        "beforeBuildCommand": "node scripts/package-manager.mjs run build",
        "frontendDist": "../dist"
      }
    }
    EOF
    
    # Cleanup function to remove temp config
    cleanup() {
        rm -f "$temp_config"
    }
    
    # Set trap to cleanup on exit
    trap cleanup EXIT

    # Start with dev profile (Tauri doesn't support custom profiles in dev mode)
    # The dev profile already has reasonable optimization settings
    TAURI_SKIP_DEVSERVER_CHECK=true {{pm}} run tauri -- dev --config "$temp_config"

# Run dev server with explicit logging levels
run-logs log_level="debug" rust_log="trace":
    #!/usr/bin/env bash
    set -euo pipefail
    RUST_LOG="{{rust_log}}" LOG_LEVEL="{{log_level}}" just run

# Run dev mode with an isolated data dir. Sets LUCODE_FLAVOR so app_paths
# routes Application Support / project data through the suffixed identifier
# instead of production paths. Default flavor is "taskflow-v2"; override
# explicitly with `just dev-run myflavor`.
dev-run flavor="taskflow-v2":
    #!/usr/bin/env bash
    set -euo pipefail
    LUCODE_FLAVOR={{flavor}} just run

# Install a flavor-isolated dev variant to /Applications. The .app bundle
# id and productName are derived from the flavor name (e.g. flavor=
# "taskflow-v2" → /Applications/Lucode-Taskflow-V2.app with identifier
# com.lucacri.lucode-taskflow-v2). Uses the same compile-time LUCODE_FLAVOR
# so the binary's app_paths reads from the matching data dir.
#
# Optional display_name lets callers override the auto-titlecased product
# name when the heuristic produces something awkward (e.g. preserve casing
# for `myFlavor` instead of getting `Myflavor`).
dev-install flavor="taskflow-v2" display_name="":
    #!/usr/bin/env bash
    set -euo pipefail

    flavor="{{flavor}}"
    display_override="{{display_name}}"

    if [ -n "$display_override" ]; then
        product_name="$display_override"
    else
        product_name="Lucode"
        IFS='-' read -ra _parts <<< "$flavor"
        for _p in "${_parts[@]}"; do
            if [ -z "$_p" ]; then continue; fi
            _head="$(printf '%s' "${_p:0:1}" | tr '[:lower:]' '[:upper:]')"
            _tail="${_p:1}"
            product_name+="-${_head}${_tail}"
        done
    fi

    bundle_id="com.lucacri.lucode-${flavor}"
    app_basename="${product_name}.app"

    echo "Building Lucode dev variant: flavor=${flavor} productName=${product_name} identifier=${bundle_id}"

    just _stamp-calver
    trap 'just _restore-version' EXIT

    # Stamp productName / identifier into the same tauri.conf.json that
    # _stamp-calver already backed up to tauri.conf.json.bak. _restore-version
    # restores from the .bak created BEFORE either edit, so both layered
    # changes get reverted together.
    sed -i '' "s/\"productName\": \"[^\"]*\"/\"productName\": \"${product_name}\"/" src-tauri/tauri.conf.json
    sed -i '' "s/\"identifier\": \"[^\"]*\"/\"identifier\": \"${bundle_id}\"/" src-tauri/tauri.conf.json

    if [ ! -d "node_modules" ]; then
        echo "Dependencies not found. Running setup first..."
        just setup
    fi

    echo "Building frontend..."
    {{pm}} run build
    if [ -d "mcp-server" ]; then
        echo "Building MCP server..."
        cd mcp-server
        node ../scripts/package-manager.mjs install --frozen-lockfile
        node ../scripts/package-manager.mjs run build
        node ../scripts/package-manager.mjs install --production --frozen-lockfile
        cd ..
        echo "MCP server built"
    fi

    echo "Building Tauri app (LUCODE_FLAVOR=${flavor}, thin LTO, parallel codegen)..."
    LUCODE_FLAVOR="${flavor}" \
    CARGO_PROFILE_RELEASE_LTO="thin" \
    CARGO_PROFILE_RELEASE_CODEGEN_UNITS="16" \
    {{pm}} run tauri -- build --bundles app

    APP_PATH=""
    for candidate in \
        "src-tauri/target/release/bundle/macos/${app_basename}" \
        "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/${app_basename}" \
        "src-tauri/target/x86_64-apple-darwin/release/bundle/macos/${app_basename}" \
        "src-tauri/target/universal-apple-darwin/release/bundle/macos/${app_basename}"; do
        if [ -d "$candidate" ]; then
            APP_PATH="$candidate"
            break
        fi
    done

    if [ -z "$APP_PATH" ]; then
        echo "Build failed - ${app_basename} not found"
        echo "Searched in:"
        echo "  - src-tauri/target/release/bundle/macos/"
        echo "  - src-tauri/target/aarch64-apple-darwin/release/bundle/macos/"
        echo "  - src-tauri/target/x86_64-apple-darwin/release/bundle/macos/"
        echo "  - src-tauri/target/universal-apple-darwin/release/bundle/macos/"
        exit 1
    fi

    echo "Found app bundle at: $APP_PATH"

    if [ -d "mcp-server/build" ]; then
        MCP_DIR="$APP_PATH/Contents/Resources/mcp-server"
        mkdir -p "$MCP_DIR"
        cp -R mcp-server/build "$MCP_DIR/"
        cp mcp-server/package.json "$MCP_DIR/"
        cp -R mcp-server/node_modules "$MCP_DIR/"
        echo "MCP server embedded in app bundle"
    fi

    SIGNING_IDENTITY="$(bash scripts/ensure-local-macos-signing-identity.sh)"
    if [ -n "$SIGNING_IDENTITY" ]; then
        echo "Signing ${product_name} with local identity: $SIGNING_IDENTITY"
        codesign --force --deep --timestamp=none --sign "$SIGNING_IDENTITY" "$APP_PATH"
        codesign --verify --deep --strict "$APP_PATH"
    fi

    INSTALL_DIR="/Applications"

    if [ -d "$INSTALL_DIR/${app_basename}" ]; then
        echo "Removing existing ${app_basename} installation..."
        echo "Admin password required to remove old installation"
        sudo rm -rf "$INSTALL_DIR/${app_basename}"
    fi

    echo "Installing ${product_name} to $INSTALL_DIR..."
    echo "Admin password required for installation"
    sudo cp -R "$APP_PATH" "$INSTALL_DIR/"

    sudo chmod -R 755 "$INSTALL_DIR/${app_basename}"
    sudo xattr -cr "$INSTALL_DIR/${app_basename}" 2>/dev/null || true

    echo "${product_name} installed successfully!"
    echo ""
    echo "Launch ${product_name}:"
    echo "  - From Spotlight: Press Cmd+Space and type '${product_name}'"
    echo "  - From Terminal: open '${INSTALL_DIR}/${app_basename}'"
    echo ""
    echo "Data dir: ~/Library/Application Support/${bundle_id}"

# Run only the frontend (Vite dev server) on auto-detected port
run-frontend:
    #!/usr/bin/env bash
    set -euo pipefail

    port=$(just _find_available_port 1420)
    echo "Starting frontend on port $port"

    export VITE_PORT=$port
    {{pm}} run dev

# Run only the backend (Tauri/Rust)
run-backend:
    #!/usr/bin/env bash
    scripts/cargo-worktree.sh run

# Run frontend and backend separately in parallel
run-split:
    #!/usr/bin/env bash
    set -euo pipefail

    port=$(just _find_available_port 1420)
    echo "Starting split mode - Frontend: $port, Backend: separate process"

    # Start frontend in background
    VITE_PORT=$port {{pm}} run dev &
    frontend_pid=$!

    # Wait a moment for frontend to start
    sleep 2

    # Start backend
    echo "Starting Rust backend..."
    FRONTEND_URL="http://localhost:$port" scripts/cargo-worktree.sh run &
    backend_pid=$!

    # Handle cleanup on exit
    trap "echo 'Stopping services...'; kill $frontend_pid $backend_pid 2>/dev/null || true" EXIT

    echo "Services running - Frontend: http://localhost:$port"
    echo "Press Ctrl+C to stop both services"

    # Wait for either process to exit
    wait

# Run on a specific port (uses pre-built release binary if available, no hot-reload)
run-port port:
    #!/usr/bin/env bash
    set -euo pipefail

    if lsof -i :{{port}} >/dev/null 2>&1; then
        echo "Port {{port}} is already in use"
        exit 1
    fi

    echo "Starting Lucode on port {{port}} (no hot-reload mode)"

    # Check if release binary exists
    PROJECT_ROOT="$(pwd)"
    BINARY_PATH="$PROJECT_ROOT/src-tauri/target/release/lucode"

    # Check shared target first
    if [ -f "/tmp/lucode-shared-target/release/lucode" ]; then
        BINARY_PATH="/tmp/lucode-shared-target/release/lucode"
    fi

    if [ ! -f "$BINARY_PATH" ]; then
        echo "No release binary found. Building one first..."
        echo "   This will take a few minutes but only needs to be done once."
        {{pm}} run build
        {{pm}} run tauri -- build
        # Re-check for binary after build
        if [ -f "/tmp/lucode-shared-target/release/lucode" ]; then
            BINARY_PATH="/tmp/lucode-shared-target/release/lucode"
        elif [ ! -f "$BINARY_PATH" ]; then
            echo "Error: Binary not found after build"
            exit 1
        fi
    else
        echo "Using existing release binary (no hot-reload)"
        echo "   To force rebuild, run: just run-port-release {{port}}"
    fi
    
    # Export the port
    export VITE_PORT={{port}}
    export PORT={{port}}
    
    # Run the release binary
    cd "$HOME" && VITE_PORT={{port}} PORT={{port}} PARA_REPO_PATH="$PROJECT_ROOT" "$BINARY_PATH"

# Run on a specific port with hot-reload (development mode with production-like performance)
run-port-dev port:
    #!/usr/bin/env bash
    set -euo pipefail

    if lsof -i :{{port}} >/dev/null 2>&1; then
        echo "Port {{port}} is already in use"
        exit 1
    fi

    echo "Starting Lucode on port {{port}} (WITH hot-reload - dev mode)"
    echo "Using standard dev profile (opt-level=0) for fast compilation"

    if [[ -z "${CARGO_TARGET_DIR:-}" ]]; then
        export CARGO_TARGET_DIR="$(git rev-parse --git-common-dir)/lucode-target"
    fi
    export CARGO_INCREMENTAL="${CARGO_INCREMENTAL:-1}"
    mkdir -p "$CARGO_TARGET_DIR"

    # Create temporary config override
    temp_config=$(mktemp)
    cat > "$temp_config" <<EOF
    {
      "build": {
        "devUrl": "http://localhost:{{port}}",
        "beforeDevCommand": "node scripts/package-manager.mjs run dev",
        "beforeBuildCommand": "node scripts/package-manager.mjs run build",
        "frontendDist": "../dist"
      }
    }
    EOF

    # Export the port for Vite
    export VITE_PORT={{port}}
    export PORT={{port}}

    # Cleanup function to remove temp config
    cleanup() {
        echo "Cleaning up temporary config..."
        rm -f "$temp_config"
    }

    # Set trap to cleanup on exit
    trap cleanup EXIT

    # Start Tauri with config override (standard dev profile for production-like performance)
    {{pm}} run tauri -- dev --config "$temp_config"

# Build the application for production
build:
    {{pm}} run build && {{pm}} run tauri -- build


# Build and run the application in production mode
run-build:
    {{pm}} run build && {{pm}} run tauri -- build && ./src-tauri/target/release/lucode

# Run all tests and lints (uses dev-fast profile for FASTEST compilation)
test:
    #!/usr/bin/env bash
    set -euo pipefail

    step() { printf '\n\033[1;36m→ %s\033[0m\n' "$1"; }
    ok() { printf '\033[1;32m✓ %s\033[0m\n' "$1"; }

    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        just _ensure-linux-rust-deps
    elif [[ "$OSTYPE" != "darwin"* ]]; then
        echo "Unsupported platform: $OSTYPE (use Linux or macOS)"
        exit 1
    fi

    if command -v sccache &> /dev/null; then
        step "Rust: sccache"
        if sccache rustc -vV >/dev/null 2>&1; then
            export RUSTC_WRAPPER=sccache
            export SCCACHE_DIR=$HOME/.cache/sccache
            ok "sccache enabled"
        else
            echo "sccache found but unusable; continuing without it"
            export RUSTC_WRAPPER=
            export CARGO_BUILD_RUSTC_WRAPPER=
        fi
    fi

    step "Lint"
    {{pm}} run lint:all && ok "All lints passed"

    step "Dependencies"
    {{pm}} run deps:rust && ok "Cargo shear passed"
    {{pm}} run deps:check && ok "Knip passed"

    if [[ -s .tracked-tests ]]; then
        step "Tracked tests"
        scripts/tracked-tests.sh run-tracked && ok "Tracked tests passed"
    fi

    step "Test: Frontend"
    {{pm}} run test:frontend && ok "Frontend tests passed"

    step "Test: MCP Server"
    {{pm}} run test:mcp && ok "MCP tests passed"

    step "Test: Rust"
    just test-rust && ok "Rust tests passed"

    printf '\n\033[1;32m✓ All checks passed\033[0m\n'


# Run only frontend tests (TypeScript, linting, unit tests)
test-frontend:
    {{pm}} run lint && {{pm}} run lint:ts && {{pm}} run test:frontend

# Track and immediately run a targeted test file
test-track path:
    scripts/tracked-tests.sh track "{{path}}"

# Stop tracking a targeted test file
test-untrack path:
    scripts/tracked-tests.sh untrack "{{path}}"

# Clear all tracked test files
test-clear:
    scripts/tracked-tests.sh clear

# Run Rust tests with nextest while silencing warnings for cleaner output
test-rust *ARGS:
    #!/usr/bin/env bash
    set -euo pipefail
    RUSTFLAGS="${RUSTFLAGS:-} -Awarnings" scripts/cargo-worktree.sh nextest run --cargo-quiet --status-level leak {{ARGS}}

# Run scoped tests for one path. Routes to nextest for src-tauri/* paths
# (extracts the module from the file path) and vitest for src/* / mcp-server/*
# paths. Use this for inner-loop work; use `just test` at integration boundaries
# and pre-commit. See CLAUDE.md "Test scope discipline" for the full rules.
#
# Examples:
#   just test-single src-tauri/src/domains/tasks/runs.rs
#   just test-single src-tauri/src/commands/forge.rs
#   just test-single src/components/sidebar/Sidebar.tsx
#   just test-single src/types/task.ts
test-single PATH:
    #!/usr/bin/env bash
    set -euo pipefail
    path="{{PATH}}"
    if [[ "$path" == src-tauri/src/* ]]; then
        if [[ "$path" != *.rs ]]; then
            echo "test-single: src-tauri/* path must be a .rs file, got: $path" >&2
            exit 2
        fi
        # Strip the src-tauri/src/ prefix and the .rs / mod.rs suffix, then turn
        # / into :: so e.g. domains/tasks/runs.rs -> domains::tasks::runs and
        # domains/tasks/mod.rs -> domains::tasks. nextest prefix-matches, so the
        # module path catches every test inside the file plus its submodules.
        module=$(echo "$path" \
            | sed -E 's|^src-tauri/src/||; s|/mod\.rs$||; s|\.rs$||; s|/|::|g')
        if [[ -z "$module" ]]; then
            echo "test-single: could not derive module from $path" >&2
            exit 2
        fi
        echo "Running cargo nextest for module: $module"
        just test-rust -p lucode "$module"
    elif [[ "$path" == src/* ]]; then
        # Vitest only matches *.test.ts / *.test.tsx. For source files we run
        # the containing DIRECTORY so every sibling test that exercises the
        # source file is picked up — touching `Sidebar.tsx` should run every
        # `Sidebar.*.test.tsx`, not just `Sidebar.test.tsx`. For test files
        # and directories, run as-is.
        if [[ "$path" == *.test.ts || "$path" == *.test.tsx ]]; then
            target="$path"
        elif [[ -d "$path" ]]; then
            target="$path"
        else
            target="$(dirname "$path")"
        fi
        echo "Running bun vitest for: $target"
        {{pm}} run lint -- "$path" || true
        bun vitest run "$target"
    elif [[ "$path" == mcp-server/* ]]; then
        echo "Running bun vitest for mcp-server path: $path"
        cd mcp-server && bun vitest run "${path#mcp-server/}"
    else
        echo "test-single: unrecognized path prefix. Use src-tauri/src/... or src/... or mcp-server/..." >&2
        echo "Got: $path" >&2
        exit 2
    fi

# Run the application using the compiled release binary (no autoreload)
run-release:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "Building Lucode (release bundle, no auto-reload)..."
    {{pm}} run build
    {{pm}} run tauri -- build
    echo "Build complete. Launching binary from HOME directory..."
    # Always start from HOME directory when using 'just run' commands
    # Pass repository path explicitly so backend can discover it even from packaged runs
    PROJECT_ROOT="$(pwd)"

    # Check for binary in shared target directory first, then fallback to local
    BINARY_PATH="/tmp/lucode-shared-target/release/lucode"
    if [ ! -f "$BINARY_PATH" ]; then
        BINARY_PATH="$PROJECT_ROOT/src-tauri/target/release/lucode"
    fi

    if [ ! -f "$BINARY_PATH" ]; then
        echo "Error: Binary not found at $BINARY_PATH"
        exit 1
    fi

    cd "$HOME" && PARA_REPO_PATH="$PROJECT_ROOT" "$BINARY_PATH"

# Run the release binary with adjustable logging (defaults to debug)
run-release-logs log_level="debug" rust_log="lucode=debug":
    #!/usr/bin/env bash
    set -euo pipefail
    RUST_LOG="{{rust_log}}" LOG_LEVEL="{{log_level}}" just run-release

# Build and run the application in release mode with a specific port
# This builds fresh like 'just run' does, but creates a release build
run-port-release port:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "Building Lucode release on port {{port}}..."

    # Export port for any runtime components that need it
    export VITE_PORT={{port}}
    export PORT={{port}}

    # Clean old binaries to force rebuild (check both shared and local target dirs)
    echo "Cleaning old release binaries..."
    rm -f ./src-tauri/target/release/lucode
    rm -f ./src-tauri/target/release/ui
    rm -f /tmp/lucode-shared-target/release/lucode

    # Build frontend
    echo "Building frontend..."
    {{pm}} run build

    # Build Tauri app properly (this embeds the frontend assets)
    echo "Building Tauri app (with frontend embedded)..."
    {{pm}} run tauri -- build

    echo "Build complete. Launching release binary from HOME directory..."
    # Always start from HOME directory when using 'just run' commands
    # The tauri build creates the binary with the productName from tauri.conf.json
    # Pass repository path explicitly so backend can discover it
    PROJECT_ROOT="$(pwd)"

    # Check for binary in shared target directory first, then fallback to local
    BINARY_PATH="/tmp/lucode-shared-target/release/lucode"
    if [ ! -f "$BINARY_PATH" ]; then
        BINARY_PATH="$PROJECT_ROOT/src-tauri/target/release/lucode"
    fi

    if [ ! -f "$BINARY_PATH" ]; then
        echo "Error: Binary not found at $BINARY_PATH"
        exit 1
    fi

    cd "$HOME" && VITE_PORT={{port}} PORT={{port}} PARA_REPO_PATH="$PROJECT_ROOT" "$BINARY_PATH"

# Cross-platform setup commands

# Cross-platform setup (auto-detect OS)
setup-cross-platform:
    #!/usr/bin/env bash
    set -euo pipefail

    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        echo "Detected Linux - running Linux-specific setup"
        just setup-linux
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        echo "Detected macOS - running standard setup"
        just setup
    else
        echo "Unsupported platform: $OSTYPE"
        exit 1
    fi

# Cross-platform install (auto-detect OS)
install-cross-platform:
    #!/usr/bin/env bash
    set -euo pipefail

    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        echo "Detected Linux - running Linux installation"
        just install-linux
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        echo "Detected macOS - running macOS installation"
        just install
    else
        echo "Unsupported platform: $OSTYPE"
        exit 1
    fi

# Linux-specific commands

# Check Linux build dependencies
check-linux-deps:
    #!/usr/bin/env bash
    echo "Checking Linux build dependencies..."
    echo ""
    which pkg-config > /dev/null 2>&1 && echo "[OK] pkg-config" || echo "[MISSING] pkg-config"
    pkg-config --exists webkit2gtk-4.1 2>/dev/null && echo "[OK] libwebkit2gtk-4.1-dev" || echo "[MISSING] libwebkit2gtk-4.1-dev"
    pkg-config --exists gtk+-3.0 2>/dev/null && echo "[OK] libgtk-3-dev" || echo "[MISSING] libgtk-3-dev"
    echo ""
    echo "To install missing dependencies:"
    echo "  Ubuntu/Debian: sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev patchelf"
    echo "  Fedora:        sudo dnf install webkit2gtk4.1-devel gtk3-devel libappindicator-gtk3-devel librsvg2-devel"
    echo "  Arch:          sudo pacman -S webkit2gtk-4.1 gtk3 libappindicator-gtk3 librsvg"

# Ensure Linux has the GTK stack required for Rust builds/tests
_ensure-linux-rust-deps:
    #!/usr/bin/env bash
    set -euo pipefail
    if ! command -v pkg-config >/dev/null 2>&1; then
        echo "ERROR: pkg-config not found. Install GTK build dependencies first."
        echo "   Run 'just check-linux-deps' for guidance."
        exit 1
    fi
    missing=()
    for pkg in gtk+-3.0 gdk-3.0 pango cairo atk; do
        if ! pkg-config --exists "$pkg"; then
            missing+=("$pkg")
        fi
    done
    if [ ${#missing[@]} -ne 0 ]; then
        echo "ERROR: Missing Linux GTK dependencies: ${missing[*]}"
        echo "   Run 'just check-linux-deps' for installation hints."
        exit 1
    fi

# Setup Linux-specific dependencies (from spec milestone 1)
setup-linux:
    #!/usr/bin/env bash
    set -euo pipefail

    echo "Setting up Linux development dependencies..."

    # Detect distribution and install GTK/WebKit stack
    if [ -f /etc/debian_version ]; then
        echo "Detected Debian/Ubuntu-based system"
        sudo apt-get update
        sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev patchelf
    elif [ -f /etc/redhat-release ]; then
        echo "Detected Red Hat-based system"
        sudo dnf install -y webkit2gtk4.1-devel gtk3-devel libappindicator-gtk3-devel librsvg2-devel patchelf
    elif [ -f /etc/arch-release ]; then
        echo "Detected Arch-based system"
        sudo pacman -S --needed webkit2gtk gtk3 libappindicator-gtk3 librsvg patchelf
    else
        echo "WARNING: Unknown distribution. Please install GTK and WebKit dependencies manually."
        echo "   Required: libwebkit2gtk-4.1-dev, libgtk-3-dev, libayatana-appindicator3-dev, librsvg2-dev, patchelf"
        exit 1
    fi

    echo "Linux dependencies installed"

# Install the application on Linux (builds and installs to ~/.local/bin with XDG compliance)
install-linux:
    #!/usr/bin/env bash
    set -euo pipefail

    echo "Building Lucode for Linux..."

    # Check if node_modules exists, if not run setup first
    if [ ! -d "node_modules" ]; then
        echo "Dependencies not found. Running setup first..."
        just setup
    fi
    
    # Build MCP server if it exists (like macOS version does)
    if [ -d "mcp-server" ]; then
        echo "Building MCP server..."
        cd mcp-server
        # Ensure clean, reproducible deps before building
        echo "Installing MCP server dependencies..."
        node ../scripts/package-manager.mjs install --production --frozen-lockfile
        node ../scripts/package-manager.mjs run build
        cd ..
        echo "MCP server built"
    fi

    # Build Tauri application binary only (skip additional bundle creation)
    echo "Building Tauri app binary..."
    {{pm}} run tauri -- build --no-bundle

    # Find the built binary (handle different architectures)
    BINARY_PATH=""
    if [ -f "src-tauri/target/release/lucode" ]; then
        BINARY_PATH="src-tauri/target/release/lucode"
    elif [ -f "src-tauri/target/x86_64-unknown-linux-gnu/release/lucode" ]; then
        BINARY_PATH="src-tauri/target/x86_64-unknown-linux-gnu/release/lucode"
    elif [ -f "src-tauri/target/aarch64-unknown-linux-gnu/release/lucode" ]; then
        BINARY_PATH="src-tauri/target/aarch64-unknown-linux-gnu/release/lucode"
    fi
    
    if [ -z "$BINARY_PATH" ] || [ ! -f "$BINARY_PATH" ]; then
        echo "Build failed - lucode binary not found"
        echo "Searched in:"
        echo "  - src-tauri/target/release/"
        echo "  - src-tauri/target/x86_64-unknown-linux-gnu/release/"
        echo "  - src-tauri/target/aarch64-unknown-linux-gnu/release/"
        exit 1
    fi

    echo "Found binary at: $BINARY_PATH"

    # Create installation directories
    echo "Installing to ~/.local/bin..."
    mkdir -p ~/.local/bin
    mkdir -p ~/.local/share/applications
    mkdir -p ~/.local/share/icons/hicolor/128x128/apps

    # Copy the binary
    cp "$BINARY_PATH" ~/.local/bin/lucode
    chmod +x ~/.local/bin/lucode

    # Copy icon (if it exists)
    if [ -f "src-tauri/icons/128x128.png" ]; then
        cp src-tauri/icons/128x128.png ~/.local/share/icons/hicolor/128x128/apps/lucode.png
    elif [ -f "src-tauri/icons/icon.png" ]; then
        cp src-tauri/icons/icon.png ~/.local/share/icons/hicolor/128x128/apps/lucode.png
    fi

    # Create desktop entry
    echo "#!/usr/bin/env xdg-open" > ~/.local/share/applications/lucode.desktop
    echo "[Desktop Entry]" >> ~/.local/share/applications/lucode.desktop
    echo "Type=Application" >> ~/.local/share/applications/lucode.desktop
    echo "Name=Lucode" >> ~/.local/share/applications/lucode.desktop
    echo "Exec=lucode" >> ~/.local/share/applications/lucode.desktop
    echo "Icon=lucode" >> ~/.local/share/applications/lucode.desktop
    echo "Categories=Development;" >> ~/.local/share/applications/lucode.desktop
    echo "Terminal=false" >> ~/.local/share/applications/lucode.desktop
    chmod +x ~/.local/share/applications/lucode.desktop

    echo "Lucode installed successfully!"
    echo ""
    echo "Launch Lucode:"
    echo "  - From application menu"
    echo "  - From Terminal: lucode"
    echo ""
    echo "If you encounter issues, ensure you have the required system libraries:"
    echo "  - libwebkit2gtk-4.1-dev"
    echo "  - libgtk-3-dev" 
    echo "  - libayatana-appindicator3-dev"
    echo "  - librsvg2-dev"
    echo "  - patchelf"

# Uninstall the application from ~/.local/bin (Linux XDG standard)
uninstall-linux:
    #!/usr/bin/env bash
    set -euo pipefail

    echo "Uninstalling Lucode..."

    # Remove the binary
    if [ -f ~/.local/bin/lucode ]; then
        rm ~/.local/bin/lucode
        echo "Removed binary from ~/.local/bin/lucode"
    else
        echo "Binary not found at ~/.local/bin/lucode"
    fi

    # Remove desktop entry
    if [ -f ~/.local/share/applications/lucode.desktop ]; then
        rm ~/.local/share/applications/lucode.desktop
        echo "Removed desktop entry from ~/.local/share/applications/lucode.desktop"
    else
        echo "Desktop entry not found at ~/.local/share/applications/lucode.desktop"
    fi

    # Remove icon
    if [ -f ~/.local/share/icons/hicolor/128x128/apps/lucode.png ]; then
        rm ~/.local/share/icons/hicolor/128x128/apps/lucode.png
        echo "Removed icon from ~/.local/share/icons/hicolor/128x128/apps/lucode.png"
    else
        echo "Icon not found at ~/.local/share/icons/hicolor/128x128/apps/lucode.png"
    fi

    # Remove MCP server data if it exists
    if [ -d ~/.local/share/lucode ]; then
        rm -rf ~/.local/share/lucode
        echo "Removed MCP server data from ~/.local/share/lucode"
    fi

    echo "Lucode uninstalled successfully!"
    echo "You may need to run 'update-desktop-database' if you use a desktop environment."

# Build all Linux packages (AppImage, deb, rpm)
build-linux:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "Building all Linux packages..."
    {{pm}} run tauri -- build --bundles appimage,deb,rpm
    echo "Build complete!"
    echo "Packages created:"
    ls -lh src-tauri/target/release/bundle/ 2>/dev/null || echo "No bundle directory found"

# Build Linux AppImage
build-linux-appimage:
    {{pm}} run tauri -- build --bundles appimage
    @echo "AppImage created in src-tauri/target/release/bundle/appimage/"

# Build Linux .deb package
build-linux-deb:
    {{pm}} run tauri -- build --bundles deb
    @echo ".deb package created in src-tauri/target/release/bundle/deb/"

# Build Linux .rpm package
build-linux-rpm:
    {{pm}} run tauri -- build --bundles rpm
    @echo ".rpm package created in src-tauri/target/release/bundle/rpm/"

# Run with Wayland debugging enabled
run-wayland:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "Starting Lucode with Wayland debugging..."
    WAYLAND_DEBUG=1 WAYLAND_DISPLAY=wayland-0 RUST_LOG=lucode=debug {{pm}} run tauri:dev

# Force X11 backend (fallback mode)
run-x11:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "Starting Lucode with X11 backend..."
    GDK_BACKEND=x11 {{pm}} run tauri:dev

# Sync upstream changes into dev and reapply the Lucode rebrand
sync-upstream:
    #!/usr/bin/env bash
    set -euo pipefail

    ORIGINAL_BRANCH=$(git rev-parse --abbrev-ref HEAD)

    echo "Fetching upstream..."
    git fetch upstream

    echo "Updating main from upstream..."
    git checkout main
    git merge upstream/main

    echo "Merging main into dev..."
    git checkout dev
    git merge main

    if git diff dev main --name-only | xargs grep -li 'schaltwerk\|Schaltwerk\|SCHALTWERK' 2>/dev/null | grep -v schaltwerk_core | grep -v SchaltEvent | grep -v SchaltwerkCore | head -1 > /dev/null 2>&1; then
        echo ""
        echo "⚠  New upstream files may contain un-rebranded Schaltwerk references."
        echo "   Review with: git diff main..dev --name-only"
        echo "   Then update any new user-visible 'Schaltwerk' strings to 'Lucode'."
    fi

    echo ""
    echo "Running validation..."
    just test

    echo ""
    echo "✓ Upstream sync complete. dev is up to date."

    if [ "$ORIGINAL_BRANCH" != "dev" ] && [ "$ORIGINAL_BRANCH" != "main" ]; then
        git checkout "$ORIGINAL_BRANCH"
    fi
