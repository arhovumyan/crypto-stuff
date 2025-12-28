# Pump.fun Token Scraper

This script automates the process of scraping new tokens from pump.fun with specific market cap filters and extracting top liquidity holder information.

## Features

- ✅ Opens a visible browser window so you can watch it work
- ✅ Navigates to pump.fun with `created_timestamp` tab
- ✅ Applies market cap filters (default: $20,000 - $1,000,000)
- ✅ Clicks on each coin individually
- ✅ Extracts top liquidity holder information
- ✅ Saves results to JSON file

## Setup

1. **Install Python dependencies:**
   ```bash
   cd scripts
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```

2. **Configure the script (optional):**
   Edit `pump-fun-scraper.py` to change:
   - `MIN_MARKET_CAP` - Minimum market cap (default: 20000)
   - `MAX_MARKET_CAP` - Maximum market cap (default: 1000000)
   - `MAX_COINS_TO_SCRAPE` - Limit number of coins (None for all, or set a number like 5 for testing)

## Usage

1. **Activate the virtual environment:**
   ```bash
   cd scripts
   source venv/bin/activate
   ```

2. **Run the scraper:**
   ```bash
   python3 pump-fun-scraper.py
   ```

3. **Watch the browser:**
   - A Chrome browser window will open
   - You'll see it navigate to pump.fun
   - It will click the filters button and set market cap values
   - It will then click on each coin and extract information
   - The browser stays open for 30 seconds at the end for review

## Output

The script creates a JSON file `pump-fun-scraped-tokens.json` with the following structure:

```json
{
  "scraped_at": "2025-01-XX...",
  "filters": {
    "min_market_cap": 20000,
    "max_market_cap": 1000000
  },
  "total_tokens": 48,
  "tokens": [
    {
      "address": "coin_address_here",
      "scraped_at": "2025-01-XX...",
      "top_liquidity_holder": "Liquidity pool",
      "liquidity_holder_address": "wallet_address_here",
      "liquidity_percentage": "14.51"
    }
  ]
}
```

## Testing

To test with just a few coins, edit the script and set:
```python
MAX_COINS_TO_SCRAPE = 3  # Only scrape first 3 coins
```

## Troubleshooting

- **No coins found**: The page structure might have changed. Check the browser window and the saved screenshot (`pump-fun-page-screenshot.png`)
- **Filter button not found**: The page might need more time to load. The script will continue anyway.
- **Input fields not working**: The script uses JavaScript fallback to set values, so this should work even if fields aren't directly clickable.

## Notes

- The browser window will be visible so you can monitor progress
- The script waits appropriately for dynamic content to load
- If an error occurs, the script saves partial results before exiting
- Screenshots and page source are saved for debugging if issues occur


