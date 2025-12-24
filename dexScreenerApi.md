Reference
DEX Screener API reference

Get the latest token profiles (rate-limit 60 requests per minute)
get

https://api.dexscreener.com
/token-profiles/latest/v1
Responses
200
Ok

application/json

Response
object
Show properties
get
/token-profiles/latest/v1

HTTP

HTTP

Copy
GET /token-profiles/latest/v1 HTTP/1.1
Host: api.dexscreener.com
Accept: */*
Test it
200
Ok


Copy
{
  "url": "https://example.com",
  "chainId": "text",
  "tokenAddress": "text",
  "icon": "https://example.com",
  "header": "https://example.com",
  "description": "text",
  "links": [
    {
      "type": "text",
      "label": "text",
      "url": "https://example.com"
    }
  ]
}
Get the latest token community takeovers (rate-limit 60 requests per minute)
get

https://api.dexscreener.com
/community-takeovers/latest/v1
Responses
200
Ok

application/json

Response
object[]
get
/community-takeovers/latest/v1

HTTP

HTTP

Copy
GET /community-takeovers/latest/v1 HTTP/1.1
Host: api.dexscreener.com
Accept: */*
Test it
200
Ok


Copy
[
  {
    "url": "https://example.com",
    "chainId": "text",
    "tokenAddress": "text",
    "icon": "https://example.com",
    "header": "https://example.com",
    "description": "text",
    "links": [
      {
        "type": "text",
        "label": "text",
        "url": "https://example.com"
      }
    ],
    "claimDate": "2025-12-24T09:49:05.954Z"
  }
]
Get the latest ads (rate-limit 60 requests per minute)
get

https://api.dexscreener.com
/ads/latest/v1
Responses
200
Ok

application/json

Response
object[]
get
/ads/latest/v1

HTTP

HTTP

Copy
GET /ads/latest/v1 HTTP/1.1
Host: api.dexscreener.com
Accept: */*
Test it
200
Ok


Copy
[
  {
    "url": "https://example.com",
    "chainId": "text",
    "tokenAddress": "text",
    "date": "2025-12-24T09:49:05.954Z",
    "type": "text",
    "durationHours": 1,
    "impressions": 1
  }
]
Get the latest boosted tokens (rate-limit 60 requests per minute)
get

https://api.dexscreener.com
/token-boosts/latest/v1
Responses
200
Ok

application/json

Response
object
get
/token-boosts/latest/v1

HTTP

HTTP

Copy
GET /token-boosts/latest/v1 HTTP/1.1
Host: api.dexscreener.com
Accept: */*
Test it
200
Ok


Copy
{
  "url": "https://example.com",
  "chainId": "text",
  "tokenAddress": "text",
  "amount": 1,
  "totalAmount": 1,
  "icon": "https://example.com",
  "header": "https://example.com",
  "description": "text",
  "links": [
    {
      "type": "text",
      "label": "text",
      "url": "https://example.com"
    }
  ]
}
Get the tokens with most active boosts (rate-limit 60 requests per minute)
get

https://api.dexscreener.com
/token-boosts/top/v1
Responses
200
Ok

application/json

Response
object
get
/token-boosts/top/v1

HTTP

HTTP

Copy
GET /token-boosts/top/v1 HTTP/1.1
Host: api.dexscreener.com
Accept: */*
Test it
200
Ok


Copy
{
  "url": "https://example.com",
  "chainId": "text",
  "tokenAddress": "text",
  "amount": 1,
  "totalAmount": 1,
  "icon": "https://example.com",
  "header": "https://example.com",
  "description": "text",
  "links": [
    {
      "type": "text",
      "label": "text",
      "url": "https://example.com"
    }
  ]
}
Check paid orders for a token (rate-limit 60 requests per minute)
get

https://api.dexscreener.com
/orders/v1/
{chainId}
/
{tokenAddress}
Path parameters
chainId
string
Example: solana
tokenAddress
string
Example: A55XjvzRU4KtR3Lrys8PpLZQvPojPqvnv5bJVHMYy3Jv
Responses
200
Ok

application/json

Response
object[]
get
/orders/v1/{chainId}/{tokenAddress}

HTTP

HTTP

Copy
GET /orders/v1/{chainId}/{tokenAddress} HTTP/1.1
Host: api.dexscreener.com
Accept: */*
Test it
200
Ok


Copy
[
  {
    "type": "tokenProfile",
    "status": "processing",
    "paymentTimestamp": 1
  }
]
Get one or multiple pairs by chain and pair address (rate-limit 300 requests per minute)
get

https://api.dexscreener.com
/latest/dex/pairs/
{chainId}
/
{pairId}
Path parameters
chainId
string
Example: solana
pairId
string
Example: JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN
Responses
200
Ok

application/json

Response
object
get
/latest/dex/pairs/{chainId}/{pairId}

HTTP

HTTP

Copy
GET /latest/dex/pairs/{chainId}/{pairId} HTTP/1.1
Host: api.dexscreener.com
Accept: */*
Test it
200
Ok


Copy
{
  "schemaVersion": "text",
  "pairs": [
    {
      "chainId": "text",
      "dexId": "text",
      "url": "https://example.com",
      "pairAddress": "text",
      "labels": [
        "text"
      ],
      "baseToken": {
        "address": "text",
        "name": "text",
        "symbol": "text"
      },
      "quoteToken": {
        "address": "text",
        "name": "text",
        "symbol": "text"
      },
      "priceNative": "text",
      "priceUsd": "text",
      "txns": {
        "ANY_ADDITIONAL_PROPERTY": {
          "buys": 1,
          "sells": 1
        }
      },
      "volume": {
        "ANY_ADDITIONAL_PROPERTY": 1
      },
      "priceChange": {
        "ANY_ADDITIONAL_PROPERTY": 1
      },
      "liquidity": {
        "usd": 1,
        "base": 1,
        "quote": 1
      },
      "fdv": 1,
      "marketCap": 1,
      "pairCreatedAt": 1,
      "info": {
        "imageUrl": "https://example.com",
        "websites": [
          {
            "url": "https://example.com"
          }
        ],
        "socials": [
          {
            "platform": "text",
            "handle": "text"
          }
        ]
      },
      "boosts": {
        "active": 1
      }
    }
  ]
}
Search for pairs matching query (rate-limit 300 requests per minute)
get

https://api.dexscreener.com
/latest/dex/search
Query parameters
q
string
Example: SOL/USDC
Responses
200
Ok

application/json

Response
object
get
/latest/dex/search

HTTP

HTTP

Copy
GET /latest/dex/search?q=text HTTP/1.1
Host: api.dexscreener.com
Accept: */*
Test it
200
Ok


Copy
{
  "schemaVersion": "text",
  "pairs": [
    {
      "chainId": "text",
      "dexId": "text",
      "url": "https://example.com",
      "pairAddress": "text",
      "labels": [
        "text"
      ],
      "baseToken": {
        "address": "text",
        "name": "text",
        "symbol": "text"
      },
      "quoteToken": {
        "address": "text",
        "name": "text",
        "symbol": "text"
      },
      "priceNative": "text",
      "priceUsd": "text",
      "txns": {
        "ANY_ADDITIONAL_PROPERTY": {
          "buys": 1,
          "sells": 1
        }
      },
      "volume": {
        "ANY_ADDITIONAL_PROPERTY": 1
      },
      "priceChange": {
        "ANY_ADDITIONAL_PROPERTY": 1
      },
      "liquidity": {
        "usd": 1,
        "base": 1,
        "quote": 1
      },
      "fdv": 1,
      "marketCap": 1,
      "pairCreatedAt": 1,
      "info": {
        "imageUrl": "https://example.com",
        "websites": [
          {
            "url": "https://example.com"
          }
        ],
        "socials": [
          {
            "platform": "text",
            "handle": "text"
          }
        ]
      },
      "boosts": {
        "active": 1
      }
    }
  ]
}
Get the pools of a given token address (rate-limit 300 requests per minute)
get

https://api.dexscreener.com
/token-pairs/v1/
{chainId}
/
{tokenAddress}
Path parameters
chainId
string
Example: solana
tokenAddress
string
A token addresses

Example: JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN
Responses
200
Ok

application/json

Response
object[]
get
/token-pairs/v1/{chainId}/{tokenAddress}

HTTP

HTTP

Copy
GET /token-pairs/v1/{chainId}/{tokenAddress} HTTP/1.1
Host: api.dexscreener.com
Accept: */*
Test it
200
Ok


Copy
[
  {
    "chainId": "text",
    "dexId": "text",
    "url": "https://example.com",
    "pairAddress": "text",
    "labels": [
      "text"
    ],
    "baseToken": {
      "address": "text",
      "name": "text",
      "symbol": "text"
    },
    "quoteToken": {
      "address": "text",
      "name": "text",
      "symbol": "text"
    },
    "priceNative": "text",
    "priceUsd": "text",
    "txns": {
      "ANY_ADDITIONAL_PROPERTY": {
        "buys": 1,
        "sells": 1
      }
    },
    "volume": {
      "ANY_ADDITIONAL_PROPERTY": 1
    },
    "priceChange": {
      "ANY_ADDITIONAL_PROPERTY": 1
    },
    "liquidity": {
      "usd": 1,
      "base": 1,
      "quote": 1
    },
    "fdv": 1,
    "marketCap": 1,
    "pairCreatedAt": 1,
    "info": {
      "imageUrl": "https://example.com",
      "websites": [
        {
          "url": "https://example.com"
        }
      ],
      "socials": [
        {
          "platform": "text",
          "handle": "text"
        }
      ]
    },
    "boosts": {
      "active": 1
    }
  }
]
Get one or multiple pairs by token address (rate-limit 300 requests per minute)
get

https://api.dexscreener.com
/tokens/v1/
{chainId}
/
{tokenAddresses}
Path parameters
chainId
string
Example: solana
tokenAddresses
string
One or multiple, comma-separated token addresses (up to 30 addresses)

Example: So11111111111111111111111111111111111111112,EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
Responses
200
Ok

application/json

Response
object[]
get
/tokens/v1/{chainId}/{tokenAddresses}

HTTP

HTTP

Copy
GET /tokens/v1/{chainId}/{tokenAddresses} HTTP/1.1
Host: api.dexscreener.com
Accept: */*
Test it
200
Ok


Copy
[
  {
    "chainId": "text",
    "dexId": "text",
    "url": "https://example.com",
    "pairAddress": "text",
    "labels": [
      "text"
    ],
    "baseToken": {
      "address": "text",
      "name": "text",
      "symbol": "text"
    },
    "quoteToken": {
      "address": "text",
      "name": "text",
      "symbol": "text"
    },
    "priceNative": "text",
    "priceUsd": "text",
    "txns": {
      "ANY_ADDITIONAL_PROPERTY": {
        "buys": 1,
        "sells": 1
      }
    },
    "volume": {
      "ANY_ADDITIONAL_PROPERTY": 1
    },
    "priceChange": {
      "ANY_ADDITIONAL_PROPERTY": 1
    },
    "liquidity": {
      "usd": 1,
      "base": 1,
      "quote": 1
    },
    "fdv": 1,
    "marketCap": 1,
    "pairCreatedAt": 1,
    "info": {
      "imageUrl": "https://example.com",
      "websites": [
        {
          "url": "https://example.com"
        }
      ],
      "socials": [
        {
          "platform": "text",
          "handle": "text"
        }
      ]
    },
    "boosts": {
      "active": 1
    }
  }
]