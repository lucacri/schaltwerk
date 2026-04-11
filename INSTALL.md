# Lucode Installation Guide

## Quick Install (Local Source Build)

```bash
# 1. Clone the repository
git clone https://github.com/lucacri/lucode.git
cd lucode

# 2. Install dependencies
bun install

# 3. Build and install Lucode into /Applications
just install-fast

# 4. Launch the application
open /Applications/Lucode.app
```

## First Launch Setup

Since Lucode is distributed without an Apple Developer certificate, macOS will block it on first launch. Follow these steps to approve the app:

### Step 1: Attempt First Launch
```bash
lucode
```
You'll see a message that "Lucode" cannot be opened because it is from an unidentified developer.

### Step 2: Open System Settings
1. Click the Apple menu  > System Settings
2. Navigate to Privacy & Security
3. Scroll down to the Security section

### Step 3: Approve the Application
1. Look for the message: "Lucode was blocked from use because it is not from an identified developer"
2. Click the "Open Anyway" button next to this message
3. You may need to enter your password

### Step 4: Confirm Launch
1. Try launching Lucode again
2. A dialog will appear asking if you're sure you want to open it
3. Click "Open"

The application will now launch and work normally. This approval is only needed once.

## Manual Installation

If you prefer to build the app bundle yourself without the `just` helper:

### Build the Application
```bash
# 1. Build the frontend and app bundle
bun run tauri:build

# 2. Copy the built app bundle into /Applications
cp -R src-tauri/target/release/bundle/macos/Lucode.app /Applications/

# 3. Remove quarantine attribute (optional, helps with Gatekeeper)
xattr -cr /Applications/Lucode.app

# 4. Ad-hoc sign the application (optional, improves security)
codesign --force --deep -s - /Applications/Lucode.app
```

### Launch from Applications
1. Open Finder
2. Navigate to Applications
3. Double-click Lucode
4. Follow the First Launch Setup steps above if blocked

## Troubleshooting

## Local Build Detection

- `just install` and `just install-fast` stamp a unique calver version into the built app bundle before copying it into `/Applications`.
- A running Lucode app compares its own version with `/Applications/Lucode.app` and shows a toast when a newer local build is installed.
- Restart Lucode after that toast to launch the newer build.

### "Lucode is damaged and can't be opened"
This usually means the quarantine attribute needs to be removed:
```bash
xattr -cr /Applications/Lucode.app
```

### "The application 'Lucode' can't be opened"
Re-sign the application:
```bash
codesign --force --deep -s - /Applications/Lucode.app
```

### App doesn't appear in Applications folder after Homebrew install
Check if it was installed to the Homebrew prefix:
```bash
ls -la $(brew --prefix)/bin/lucode
```

### Terminal permissions issues
If Lucode can't create terminals:
1. Go to System Settings > Privacy & Security > Developer Tools
2. Add Terminal.app or your preferred terminal
3. Restart Lucode

### Port 8547 already in use
Lucode runs an API server on port 8547. If this port is in use:
```bash
# Find what's using the port
lsof -i :8547

# Kill the process if needed
kill -9 <PID>
```

## Uninstallation

### Via Local Install
```bash
rm -rf /Applications/Lucode.app
```

### Manual Uninstallation
```bash
# Remove the application
rm -rf /Applications/Lucode.app

# Remove application support files
rm -rf ~/Library/Application\ Support/lucode

# Remove logs
rm -rf ~/Library/Logs/lucode
```

## Building from Source

If you need to build Lucode from source:

### Prerequisites
- Bun 1.2 or later (JS tooling)
- Node.js 20 or later (for compatibility and native tooling)
- Rust 1.75 or later
- Xcode Command Line Tools

### Build Steps
```bash
# 1. Clone the repository
git clone https://github.com/lucacri/lucode.git
cd lucode

# 2. Install dependencies
bun install        # or: npm install

# 3. Build and install the application
just install-fast

# 4. The built app will be in:
# src-tauri/target/release/bundle/macos/Lucode.app
```

## Security Considerations

### Why the Security Warning?
Lucode is distributed without an Apple Developer certificate ($99/year) to keep it free and open. The ad-hoc signing we use provides:
- Basic code integrity verification
- Protection against tampering after download
- Consistent behavior across launches

### What Permissions Does Lucode Need?
- **File System Access**: To read and write Para session files
- **Process Spawning**: To create terminal sessions (PTY)
- **Network Access**: Local API server on port 8547
- **No Special Entitlements**: No camera, microphone, or contacts access

### Is It Safe?
- All code is open source and auditable
- No external network connections (only localhost)
- No telemetry or data collection
- Built and signed via GitHub Actions for transparency

## Support

For issues or questions:
1. Review the [CLAUDE.md](./CLAUDE.md) for development guidelines
2. Rebuild with `just install-fast`
3. Check the local terminal/log output for bundle or permission failures
