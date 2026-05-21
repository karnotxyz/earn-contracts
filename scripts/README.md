# Factory Deployment Scripts

Deployment tooling for the Karnot Earn factory stack. These scripts are intentionally scoped to:

- `contracts::Primer`
- `eth_712_account::StarknetEth712Account`
- `account_factory::AccountFactory`

They do not deploy strategy contracts.

## Requirements

- Bun
- Scarb `2.14.0`
- A funded Starknet deployer account for the target network
- A Starknet RPC URL for the target network

Install the script dependencies:

```sh
cd scripts
bun install
```

## Configuration

Public environment config lives in:

```text
scripts/config/sepolia.json
scripts/config/mainnet.json
```

These files should contain only public values:

- `starknet.chainId`
- `factory.multisigAddress`
- `factory.upgradeDelaySeconds`

Example:

```json
{
  "starknet": {
    "chainId": "SN_SEPOLIA"
  },
  "factory": {
    "multisigAddress": "0x...",
    "upgradeDelaySeconds": "0"
  }
}
```

Secrets and runtime values are read from the environment:

```sh
export RPC_URL="https://..."
export DEPLOYER_ADDRESS="0x..."
export DEPLOYER_PRIVATE_KEY="0x..."
```

You can also create `scripts/.env` from the example:

```sh
cd scripts
cp .env.example .env
```

Never store private keys in `scripts/config/*.json`; the loader rejects plain private keys in public config.

## Commands

Run commands from `scripts/`:

```sh
cd scripts
```

Validate config, env vars, and RPC chain id:

```sh
bun run deploy validate --env sepolia
```

Show manifest status:

```sh
bun run deploy status --env sepolia
```

Preview the factory deployment plan:

```sh
bun run deploy factory --env sepolia
```

Execute the plan:

```sh
bun run deploy factory --env sepolia --execute
```

Audit local release artifacts against the manifest and deployed factory state:

```sh
bun run deploy audit --env sepolia
```

Override config or manifest paths:

```sh
bun run deploy factory \
  --env sepolia \
  --config-path ./config/sepolia.json \
  --manifest-path ./manifests/sepolia.json
```

## What `factory` Deploys

The declaration order is:

1. `Primer`
2. `StarknetEth712Account`
3. `AccountFactory`

The factory constructor uses:

- `governance_admin = factory.multisigAddress`
- `upgrade_delay = factory.upgradeDelaySeconds`
- `account_class_hash = StarknetEth712Account class hash`

Before planning/execution, the script verifies the mandatory `Primer` class hash via:

```sh
scripts/verify_primer_class_hash.sh
```

Deployment uses release artifacts only. Build them with:

```sh
SCARB_PROFILE=release scarb build
```

## Manifests and Idempotency

Manifests are stored at:

```text
scripts/manifests/<env>.json
```

The manifest records:

- declared class hashes
- compiled class hashes
- release artifact paths
- declaration transaction hashes when available
- factory address
- factory deployment transaction hash
- constructor args
- chain id

If a matching declaration or factory deployment is already recorded, the script skips it. If the manifest records a class hash that differs from the current release artifact, the command fails instead of silently overwriting deployment history.

The manifest is saved after each successful transaction.

## Mainnet Safety

Mainnet execution requires both `--execute` and `--confirm-mainnet`:

```sh
bun run deploy factory --env mainnet --execute --confirm-mainnet
```

By default, mainnet execution also requires a clean git worktree. To override that guard:

```sh
bun run deploy factory --env mainnet --execute --confirm-mainnet --allow-dirty
```

Use `--allow-dirty` only when you have intentionally reviewed the local changes.

## Verification

Run these checks before a production deployment:

```sh
cd scripts
bun run typecheck
bun test
cd ..
SCARB_PROFILE=release scarb build
scripts/verify_primer_class_hash.sh
```

For account-contract EIP-712 changes, also run:

```sh
scarb --manifest-path eth_712_account/Scarb.toml run test
```

## Account Demo UI

The local MetaMask demo can be started with:

```sh
cd scripts
bun run ui:account-demo
```

Open:

```text
http://localhost:8787
```

The demo reads the same `RPC_URL`, `DEPLOYER_ADDRESS`, and `DEPLOYER_PRIVATE_KEY` environment variables. It is intended for local testing only because the server relays signed account actions through the configured deployer account.
