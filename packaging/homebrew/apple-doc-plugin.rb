# typed: false
# frozen_string_literal: true

class AppleDocPlugin < Formula
  desc "Apple Developer Documentation MCP Server with hybrid semantic search"
  homepage "https://github.com/AndrewMason7/apple-doc-plugin"
  url "https://github.com/AndrewMason7/apple-doc-plugin/archive/refs/tags/v1.0.0.tar.gz"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"
  license "MIT"
  head "https://github.com/AndrewMason7/apple-doc-plugin.git", branch: "main"

  depends_on "node"

  def install
    system "npm", "install", *Language::Node.std_npm_install_args(libexec)
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  def caveats
    <<~EOS
      To initialize vector embeddings and connect your editor to Apple Docs MCP:
        apple-doc-plugin setup
        apple-doc-plugin install --target cursor  # (or claude-desktop, windsurf, antigravity)
    EOS
  end

  test do
    output = shell_output("#{bin}/apple-doc-plugin --help")
    assert_match "Apple Developer Documentation MCP Server", output
  end
end
