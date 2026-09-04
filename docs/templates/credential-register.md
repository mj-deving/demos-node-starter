# Value-free credential register

Copy this table into private operator documentation. Never record a token value, token prefix, hash, recovery code, or secret-bearing URL here.

| Credential ID/alias | Provider | Purpose | Scope (`node` or `operator fleet`) | Node aliases | Permissions | Issued | Expires | IP restrictions | Quota monitor | Rotation owner/date | Revocation URL |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Example: `helius-testnet-fleet-a` | Helius | Solana address activity | operator fleet | `node-a`, `node-b` | API key; fleet IP allowlist | YYYY-MM-DD | YYYY-MM-DD | enabled | dashboard alert | Operator / YYYY-MM-DD | issuer dashboard |

Store this register separately from public Git history if node aliases or operational metadata are sensitive. The values themselves remain only in the issuer and `/etc/demos-node/node.env` on each applicable node.
