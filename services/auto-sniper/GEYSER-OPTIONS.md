# Yellowstone gRPC / Geyser Access Options

## Issue: Helius might not support Yellowstone gRPC for free/basic tiers

### Alternative Solutions:

#### Option 1: Use Triton (Paid)
- Direct Yellowstone gRPC access
- ~$99/month minimum
- Best coverage

#### Option 2: Use Helius Enhanced WebSockets (Current approach)
- Subscribe to ALL transaction logs
- Filter for InitializeMint
- Should catch most tokens
- Free/included in Helius plan

#### Option 3: Run own validator with Geyser plugin
- 100% coverage
- Requires infrastructure
- Complex setup

### Current Implementation Status:

We're using **Enhanced WebSocket monitoring** with:
- Token Program subscription
- Token-2022 Program subscription  
- Pump.fun Program subscription
- Transaction log filtering

This should catch 95%+ of tokens. For 100% coverage, need Yellowstone gRPC from Triton or similar provider.

### To upgrade to TRUE Geyser (100% coverage):

1. Sign up for Triton: https://triton.one/
2. Get Yellowstone gRPC endpoint + credentials
3. Update .env with TRITON_GRPC_URL and TRITON_API_KEY
4. Enable service1-token-discovery-geyser.ts
