cask "lucode" do
  version "0.1.0"
  sha256 :no_check

  url "https://github.com/lucacri/lucode/releases/download/v#{version}/Lucode-#{version}-universal.dmg"
  name "Lucode"
  desc "Visual interface for managing Para sessions"
  homepage "https://github.com/lucacri/lucode"

  uninstall_preflight do
    staged_app = staged_path/"Lucode.app"
    next unless staged_app.exist?

    # Clean up stale staged apps left behind by interrupted upgrades.
    next if staged_app.symlink?

    require "fileutils"
    FileUtils.rm_rf(staged_app)
  end

  app "Lucode.app"

  uninstall delete: [
    "#{HOMEBREW_PREFIX}/bin/lucode",
  ]

  zap trash: [
    "~/Library/Application Support/lucode",
    "~/Library/Logs/lucode",
    "~/Library/Preferences/com.lucacri.lucode.plist",
    "~/Library/Saved Application State/com.lucacri.lucode.savedState",
  ]
end
