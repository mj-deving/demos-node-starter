# 0006: Provider credential purpose and fleet scope

- Status: accepted
- Date: 2026-09-04

## Context

The original runner message asked every operator to create GitHub, Etherscan, and Helius credentials, including a classic GitHub token with broad scopes. It did not explain what each credential enabled or whether one operator could safely use one credential across a ten-node fleet. The starter README called the integrations optional while its setup helper required all three, so a beginner could not tell which rule was authoritative.

## Decision

- The public documentation is sufficient to understand credential purpose and policy; source inspection is supporting verification, not an operator prerequisite.
- `HELIUS_API_KEY` is the only current core API credential in initial setup because the current node path uses Helius for Solana address-activity lookup.
- `GITHUB_TOKEN` is feature-gated for GitHub Gist-backed Web2 proof lookup. The observed read path does not justify classic `repo` access. The starter does not instruct operators to create a classic token with `repo` scope.
- `ETHERSCAN_API_KEY` is feature-gated for EVM address transaction-history lookup. Current installed call sites are dormant, so it does not block initial setup.
- One operator may use one Helius or Etherscan project key across that operator's own nodes if the provider plan permits it, aggregate quotas are monitored, IP restrictions cover only those nodes where supported, and rotation can be coordinated. Sharing across unrelated operators is prohibited.
- A GitHub credential placed on a fleet must have no repository access and only the minimum access needed for the confirmed Gist path. A broad personal token must never be copied to multiple VPS hosts.
- Provider API tokens are rotatable and revocable. They are not DEMOS node identity and are not included in node-identity recovery archives.
- The command center stores only a value-free credential register. Actual values remain in the issuer and the root-owned node environment.

## Consequences

Beginners can install and run the node without inventing permissions for dormant integrations. A ten-node operator can avoid unnecessary key sprawl while accepting one shared fleet key's aggregate quota and larger revocation blast radius. Maintainer confirmation remains required before the starter claims final network credential policy or enables broader GitHub access.
