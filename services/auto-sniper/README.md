# 🤖 Automated Solana Token Sniper

A fully automated 3-service trading system that discovers new Solana tokens, evaluates them against strict criteria, and executes profitable trades.

## 🏗️ Architecture

### Service 1: Token Discovery
- **Purpose**: Monitors Solana blockchain for newly created tokens
- **Method**: Subscribes to SPL Token Program events via Helius WebSocket
- **Output**: Saves new token mints to MongoDB with UNPROCESSED status

### Service 2: Token Evaluation
- **Purpose**: Evaluates tokens against trading criteria every minute
- **Checks**:
  1. ✅ Market cap reached $20K within 60 minutes of launch
  2. ✅ Price dropped 50% from all-time high
  3. ✅ No single wallet holds more than 30% of liquidity
  4. ✅ 100% bonding curve progress (if applicable)
- **Output**: Updates token status to QUALIFIED or REJECTED with detailed reasons

### Service 3: Trade Execution
- **Purpose**: Executes trades on qualified tokens and monitors for 2x profit
- **Actions**:
  - Swaps SOL for qualified tokens via Jupiter
  - Monitors positions every second
  - Exits when price doubles (100% profit)
  - Logs all trades with profit/loss

## 📊 Token Status Flow

```
NEW MINT → UNPROCESSED → CHECKING → QUALIFIED → POSITION_OPEN → POSITION_CLOSED
                            ↓
                         REJECTED
```

## 🚀 Quick Start

### Prerequisites

1. **MongoDB** - Install and run MongoDB:
   ```bash
   # macOS
   brew install mongodb-community
   brew services start mongodb-community
   
   # Or use Docker
   docker run -d -p 27017:27017 --name mongodb mongo:latest
   ```

2. **Node.js** - Version 20 or higher

3. **Environment Variables** - Already configured in root `.env`

### Installation

```bash
cd services/auto-sniper
npm install
```

### Running the Services

**You need 3 separate terminal windows:**

#### Terminal 1: Token Discovery
```bash
cd services/auto-sniper
npm run service1
```

#### Terminal 2: Token Evaluation
```bash
cd services/auto-sniper
npm run service2
```

#### Terminal 3: Trade Execution
```bash
cd services/auto-sniper
npm run service3
```

## 📝 Logging

All services provide comprehensive logging with timestamps in format `HH:MM:SS`:

### Service 1 Output Example:
```
[18:45:21] 🆕 NEW TOKEN DISCOVERED: 7xKXt...abc123
   ├─ Mint Time: 12/27/2025, 6:45:21 PM
   ├─ TX: 5Yx2K...def456
   └─ Status: UNPROCESSED
```

### Service 2 Output Example:
```
[18:46:21] 🔎 Evaluating token: 7xKXt...abc123
   💰 Current Price: $0.0000123456
   📊 Market Cap: $15,234
   💧 Liquidity: $8,500
   ⏳ Market cap: $15,234 (waiting for $20K within 60 min)
   ❌ Price only dropped 25.5% from ATH (need 50%)
   ✅ Top holder: 18.5% < 30%
   ✅ Bonding curve: 100% complete
   ⏳ Still checking... (some criteria not yet determined)
```

### Service 3 Output Example:
```
[18:52:45] 💸 Executing BUY for 7xKXt...abc123
   Amount: 0.1 SOL
   📊 Getting quote from Jupiter...
   💱 Quote received:
      Input: 0.1 SOL
      Output: 8234.56 tokens
      Est. Price: $0.0000121544
      Price Impact: 0.12%
   ✅ BUY SUCCESSFUL!
      TX: 3Kl9m...ghi789
   📍 Position opened - monitoring for 2x exit...

[18:55:30] 🎯 TARGET HIT! 7xKXt...abc123
   Entry Price: $0.0000121544
   Current Price: $0.0000243088
   Profit: 100.00%
   
[18:55:35] ✅ SELL SUCCESSFUL!
      TX: 9Bx7n...jkl012
      Profit: 0.0950 SOL (95.00%)
```

## ⚙️ Configuration

Edit root `.env` file:

```bash
# Buy amount per trade
FIXED_BUY_AMOUNT_SOL=0.1

# Max slippage (100 = 1%)
MAX_SLIPPAGE_BPS=100

# Your wallet seed phrase
COPY_WALLET_SEED_PHRASE=your twelve word seed phrase here...
```

## 🔍 Monitoring Database

To view tokens in MongoDB:

```bash
# Connect to MongoDB
mongosh

# Switch to database
use solana_auto_sniper

# View all tokens
db.tokens.find().pretty()

# View qualified tokens
db.tokens.find({status: "QUALIFIED"}).pretty()

# View open positions
db.tokens.find({status: "POSITION_OPEN"}).pretty()

# View closed positions with profit
db.tokens.find({status: "POSITION_CLOSED"}).pretty()

# Count by status
db.tokens.aggregate([
  { $group: { _id: "$status", count: { $sum: 1 } } }
])
```

## 🛑 Stopping Services

Press `Ctrl+C` in each terminal to gracefully shut down services.

## ⚠️ Important Notes

1. **Paper Trading**: Test with small amounts first
2. **Rate Limiting**: Services include delays to avoid API rate limits
3. **Risk Management**: Only invest what you can afford to lose
4. **Slippage**: High volatility tokens may have higher slippage
5. **Gas Fees**: Each trade incurs Solana transaction fees (~0.000005 SOL)

## 🔧 Troubleshooting

### MongoDB Connection Error
```bash
# Make sure MongoDB is running
brew services list | grep mongodb

# Or check Docker
docker ps | grep mongo
```

### No Tokens Being Discovered
- Check Helius API key in `.env`
- Verify WebSocket connection
- Monitor Service 1 logs for errors

### Trades Not Executing
- Verify wallet has SOL balance
- Check Jupiter API is responding
- Ensure Service 3 sees QUALIFIED tokens

## 📈 Performance Tips

1. **Reduce Service 2 Interval**: Change `checkIntervalMs` to 30000 (30 seconds) for faster checks
2. **Adjust Criteria**: Modify criteria in Service 2 to be more/less strict
3. **Increase Buy Amount**: Edit `FIXED_BUY_AMOUNT_SOL` for larger positions
4. **Monitor Multiple Tokens**: Service 3 can handle multiple positions simultaneously

## 🎯 Success Metrics

Track your performance:
- Total trades executed
- Win rate (profitable trades / total trades)
- Average profit per trade
- Total profit in SOL
- Largest win/loss

Query MongoDB for stats:
```javascript
// Total trades
db.tokens.count({status: "POSITION_CLOSED"})

// Profitable trades
db.tokens.count({
  status: "POSITION_CLOSED",
  "tradeData.profitLoss": { $gt: 0 }
})

// Total profit
db.tokens.aggregate([
  { $match: { status: "POSITION_CLOSED" } },
  { $group: { _id: null, total: { $sum: "$tradeData.profitLoss" } } }
])
```

## 🚨 Safety Features

- ✅ Comprehensive logging with timestamps
- ✅ Graceful shutdown handling
- ✅ Error recovery and retry logic
- ✅ Rate limit protection
- ✅ Transaction confirmation checks
- ✅ Slippage protection

## 📞 Support

For issues or questions, check the logs first. Each service provides detailed error messages.

---

**Built with ❤️ for the Solana ecosystem**
