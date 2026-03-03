class Lucode < Formula
  desc "Visual interface for managing Para sessions"
  homepage "https://github.com/lucacri/lucode"
  version "0.1.0"
  
  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/lucacri/lucode/releases/download/v#{version}/lucode-#{version}-aarch64-apple-darwin.tar.gz"
      sha256 "PLACEHOLDER_ARM_SHA256" # aarch64
    else
      url "https://github.com/lucacri/lucode/releases/download/v#{version}/lucode-#{version}-x86_64-apple-darwin.tar.gz"
      sha256 "PLACEHOLDER_INTEL_SHA256" # x86_64
    end
  end

  depends_on :macos

  def install
    app = "Lucode.app"
    
    (libexec/"bin").install app
    
    system "codesign", "--force", "--deep", "--sign", "-", "#{libexec}/bin/#{app}"
    system "xattr", "-cr", "#{libexec}/bin/#{app}"
    
    (bin/"lucode").write <<~EOS
      #!/bin/bash
      exec "#{libexec}/bin/#{app}/Contents/MacOS/lucode" "$@"
    EOS
    (bin/"lucode").chmod 0755
    
    ohai "Installation complete!"
    ohai ""
    ohai "IMPORTANT: First-time setup required"
    ohai "======================================"
    ohai ""
    ohai "Since this app is not signed with an Apple Developer certificate,"
    ohai "you'll need to approve it in System Settings on first launch:"
    ohai ""
    ohai "1. Try to open Lucode (it will be blocked)"
    ohai "2. Open System Settings > Privacy & Security"
    ohai "3. Find 'Lucode was blocked' message"
    ohai "4. Click 'Open Anyway'"
    ohai "5. Confirm when prompted"
    ohai ""
    ohai "This is only needed once. The app will work normally afterwards."
    ohai ""
    ohai "To launch: lucode"
  end

  def caveats
    <<~EOS
      To use Lucode, you may need to grant additional permissions:
      
      - Terminal access: for PTY functionality
      - File system access: for session management
      
      The app will prompt for these permissions when needed.
    EOS
  end

  test do
    assert_predicate prefix/"Lucode.app", :exist?
    assert_predicate prefix/"Lucode.app/Contents/MacOS/lucode", :executable?
  end
end