class CodexMobile < Formula
  desc "iPhone-first local Codex workbench"
  homepage "https://github.com/StephenPCG/CodexMobile"

  # For a public tap, replace this moving source with a tagged tarball + sha256.
  url "https://github.com/StephenPCG/CodexMobile.git", branch: "main"
  version "0.1.0"
  head "https://github.com/StephenPCG/CodexMobile.git", branch: "main"

  depends_on "node"

  def install
    system "npm", "ci"
    system "npm", "run", "build"
    libexec.install Dir["*"]
    bin.install_symlink libexec/"bin/codex-mobile.mjs" => "codex-mobile"
  end

  service do
    run [opt_bin/"codex-mobile", "start"]
    keep_alive true
    log_path var/"log/codex-mobile.log"
    error_log_path var/"log/codex-mobile.err.log"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/codex-mobile --version")
  end
end
