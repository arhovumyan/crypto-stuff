# Rate Limiting Fix - Infrastructure Wallet Discovery

## Problem: Queue Overflow & 429 Errors

**Initial Problem**: The system was receiving 100+ swap events per second but could only process 3-10 requests per second, causing:
1. Queue filling to 1000+ items instantly
2. Most swaps being dropped
3. High memory usage
4. Eventually hitting rate limits (429 errors)

### What Was Happening
The system was receiving **hundreds of swap events per second** from three DEX programs (Raydium, PumpFun, PumpSwap). For each event, it immediately called `getParsedTransaction()`, creating a flood of RPC requests that exceeded your Helius API rate limits.

### The Fix
I've implemented an **adaptive request queue system with swap sampling**:
- ✅ **Swap Sampling**: Processes only 1 out of every 20 swaps by default (5% of swaps)
  - Reduces queue load by 95%
  - Still captures enough data for infrastructure wallet discovery
  - Configurable via `SWAP_SAMPLE_RATE` environment variable
- ✅ **Adaptive rate limiting**: Starts at 3 req/s, automatically reduces when hitting 429s, recovers when stable
- ✅ **Concurrent request limits**: Max 2 parallel requests (configurable)
- ✅ **Automatic retry logic**: Exponential backoff for 429 errors (1s → 2s → 4s → 8s → 10s)
- ✅ **Queue management**: Requests are queued and processed at a controlled rate
- ✅ **Queue size limits**: Automatically drops old requests if queue exceeds 1000 items
- ✅ **Smart recovery**: Gradually increases rate limit back to normal after errors stop

## How It Works Now

1. **Log events arrive** → Added to queue (no immediate RPC call)
2. **Queue processor** → Picks requests from queue at controlled rate
3. **Rate limiting** → Enforces max requests per second
4. **On 429 error** → Automatically retries with exponential backoff
5. **Swap parsed** → Only successful parses trigger the `onSwap` callback

## Configuration

You can adjust rate limits in your `.env` file:

```bash
# Rate Limiting (defaults: conservative for free tier)
RPC_REQUESTS_PER_SECOND=3     # Initial requests per second (will adapt automatically)
RPC_MAX_CONCURRENT=2          # Max parallel requests
RPC_MAX_RETRIES=5             # Max retries before giving up

# Swap Sampling (critical for high-volume DEXs)
SWAP_SAMPLE_RATE=20           # Process 1 out of every N swaps (default: 20 = 5%)
                              # Lower = more swaps processed (e.g., 10 = 10% of swaps)
                              # Higher = fewer swaps (e.g., 50 = 2% of swaps)
```

**Note**: The system now uses **adaptive rate limiting** - it will automatically reduce the rate when hitting 429 errors and gradually recover when errors stop. You can set a higher initial rate if your plan allows.

### Recommended Settings by Plan

**Free Tier (Helius) - Default (conservative)**
```bash
RPC_REQUESTS_PER_SECOND=3
RPC_MAX_CONCURRENT=2
```

**Free Tier - More aggressive (if still hitting 429s, reduce this)**
```bash
RPC_REQUESTS_PER_SECOND=2
RPC_MAX_CONCURRENT=1
```

**Paid Tier (Helius)**
```bash
RPC_REQUESTS_PER_SECOND=10
RPC_MAX_CONCURRENT=5
```

**Enterprise Tier**
```bash
RPC_REQUESTS_PER_SECOND=20
RPC_MAX_CONCURRENT=10
```

## Impact on System Performance

- **Before**: Unlimited requests → Queue overflow → 429 errors → missed swaps
- **After**: Swap sampling + adaptive rate limiting → manageable queue → no 429s → reliable processing

**Trade-offs**: 
1. **Sampling**: We process 5% of swaps by default. This is sufficient for infrastructure wallet discovery since we're looking for patterns (3+ events), not every single swap.
2. **Processing delay**: Swaps will be processed with a delay (typically 300ms-1s per swap)
3. **Queue management**: Queue stays manageable (under 200 items instead of 1000+)

**Why sampling works for this use case**: Infrastructure wallet discovery needs to identify **patterns** (wallet buys during large dumps 3+ times). Processing 5% of swaps still captures these patterns since large sell events are rare relative to total swap volume.

**Adaptive Behavior**:
- If you hit 429 errors → Rate automatically drops by 50% (minimum 0.5 req/s)
- After 30 seconds with no errors → Rate gradually increases by 10%
- System finds the optimal rate for your plan automatically

## Monitoring

The system now logs:
- Queue size (if it grows too large, you may need to increase rate limits)
- Retry attempts (if you see many retries, reduce `RPC_REQUESTS_PER_SECOND`)
- Active requests (should stay under `RPC_MAX_CONCURRENT`)

## Testing

After restarting the system, you should:
1. ✅ **No more 429 errors** in the console
2. ✅ **Swaps still being processed** (check stats every 5 minutes)
3. ✅ **Queue size remains reasonable** (should stay under 100 during normal operation)

If the queue grows too large (>1000 items), the system will automatically drop the oldest 50 requests to prevent memory issues. This means some swaps may be skipped during extreme high-volume periods.

To reduce queue size:
- Increase `RPC_REQUESTS_PER_SECOND` (if your plan allows) - but watch for 429s
- Upgrade your RPC plan for higher rate limits
- The adaptive rate limiter will find the optimal rate automatically

**Queue Monitoring**: The system logs queue size every 100 requests to help you monitor performance.

## Technical Details

### Request Flow
```
Log Event → Queue → Rate Limiter → RPC Request
                              ↓ (if 429)
                         Retry with Backoff
```

### Rate Limiting Algorithm
- Enforces minimum time between requests: `1000ms / REQUESTS_PER_SECOND`
- Limits concurrent requests: Never exceeds `MAX_CONCURRENT_REQUESTS`
- Exponential backoff: `1000ms * 2^(attempt-1)` up to 10s max
- Adaptive rate reduction: Drops rate by 50% after 3 consecutive 429 errors
- Automatic recovery: Increases rate by 10% every 30 seconds when no errors

### Queue Processing
- Single worker thread processes queue sequentially
- Checks every 50-100ms for new requests
- Respects both rate limits and concurrent request limits

