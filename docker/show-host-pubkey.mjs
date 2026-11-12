/**
 * Read the host public key. The runner's ~/.ssh is the computer's ~/.ssh mounted read-only,
 * so this must not run ssh-keygen.
 */
export const SHOW_HOST_PUBKEY = [
  'if [ -f "$HOME/.ssh/id_ed25519.pub" ]; then',
  '  echo "Public key from this computer (~/.ssh/id_ed25519.pub):"',
  '  echo ""',
  '  cat "$HOME/.ssh/id_ed25519.pub"',
  '  echo ""',
  '  echo "Upload this public key to the hosting SSH keys. This did not create a key."',
  "else",
  '  echo "No public key at ~/.ssh/id_ed25519.pub on this computer." >&2',
  '  echo "Create it on this computer, then show the key again:" >&2',
  '  echo \'ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -C "you@host"\' >&2',
  "  exit 1",
  "fi",
].join("\n");
