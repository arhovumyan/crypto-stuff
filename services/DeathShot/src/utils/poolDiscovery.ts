import { Connection, PublicKey } from '@solana/web3.js';
import { logger } from '../logger';

export interface PoolInfo {
  mint: string;
  poolAddress: string;
  baseVault: string;
  quoteVault: string;
  poolType: 'raydium' | 'orca' | 'pumpfun';
}

// Known DEX program IDs
const RAYDIUM_AMM = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');
const PUMPFUN_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');

/**
 * Discover pool information for a token mint
 * For Pump.fun tokens: finds bonding curve account
 * For Raydium: finds AMM pool and vaults
 */
export async function discoverPoolInfo(
  connection: Connection,
  mintAddress: string
): Promise<PoolInfo | null> {
  try {
    const mint = new PublicKey(mintAddress);
    logger.info({ mint: mintAddress }, 'Discovering pool info for token');

    // Check if it's a Pump.fun token
    const pumpInfo = await tryPumpfunPool(connection, mint);
    if (pumpInfo) {
      return pumpInfo;
    }

    // Check for Raydium pool
    const raydiumInfo = await tryRaydiumPool(connection, mint);
    if (raydiumInfo) {
      return raydiumInfo;
    }

    logger.warn({ mint: mintAddress }, 'No pool found for token');
    return null;
  } catch (error) {
    logger.error({ error, mint: mintAddress }, 'Error discovering pool');
    return null;
  }
}

/**
 * Try to find Pump.fun bonding curve account
 * Pump.fun uses a PDA derived from mint address
 */
async function tryPumpfunPool(
  connection: Connection,
  mint: PublicKey
): Promise<PoolInfo | null> {
  try {
    // Derive bonding curve PDA: seeds = ["bonding-curve", mint]
    const [bondingCurve] = PublicKey.findProgramAddressSync(
      [Buffer.from('bonding-curve'), mint.toBuffer()],
      PUMPFUN_PROGRAM
    );

    // Check if account exists
    const accountInfo = await connection.getAccountInfo(bondingCurve);
    if (!accountInfo) {
      return null;
    }

    // Derive associated token accounts (vaults)
    // Pump.fun stores SOL and token in specific vaults
    const [baseVault] = PublicKey.findProgramAddressSync(
      [Buffer.from('token-vault'), bondingCurve.toBuffer()],
      PUMPFUN_PROGRAM
    );

    const [quoteVault] = PublicKey.findProgramAddressSync(
      [Buffer.from('sol-vault'), bondingCurve.toBuffer()],
      PUMPFUN_PROGRAM
    );

    logger.info({
      mint: mint.toBase58(),
      bondingCurve: bondingCurve.toBase58(),
      baseVault: baseVault.toBase58(),
      quoteVault: quoteVault.toBase58()
    }, 'Found Pump.fun pool');

    return {
      mint: mint.toBase58(),
      poolAddress: bondingCurve.toBase58(),
      baseVault: baseVault.toBase58(),
      quoteVault: quoteVault.toBase58(),
      poolType: 'pumpfun'
    };
  } catch (error) {
    logger.debug({ error }, 'Not a Pump.fun pool');
    return null;
  }
}

/**
 * Try to find Raydium AMM pool for token
 */
async function tryRaydiumPool(
  connection: Connection,
  mint: PublicKey
): Promise<PoolInfo | null> {
  try {
    // Query all Raydium AMM accounts that contain this mint
    let accounts = await connection.getProgramAccounts(RAYDIUM_AMM, {
      filters: [
        { dataSize: 752 }, // Raydium AMM account size
        {
          memcmp: {
            offset: 400, // Token A mint offset
            bytes: mint.toBase58()
          }
        }
      ]
    });

    if (accounts.length === 0) {
      // Try token B position
      accounts = await connection.getProgramAccounts(RAYDIUM_AMM, {
        filters: [
          { dataSize: 752 },
          {
            memcmp: {
              offset: 432, // Token B mint offset
              bytes: mint.toBase58()
            }
          }
        ]
      });

      if (accounts.length === 0) {
        return null;
      }
    }

    // Use first pool found (usually most liquid)
    const poolAddress = accounts[0].pubkey;
    const data = accounts[0].account.data;

    // Parse vault addresses from account data
    // Raydium stores vaults at specific offsets
    const baseVault = new PublicKey(data.slice(256, 288));
    const quoteVault = new PublicKey(data.slice(288, 320));

    logger.info({
      mint: mint.toBase58(),
      poolAddress: poolAddress.toBase58(),
      baseVault: baseVault.toBase58(),
      quoteVault: quoteVault.toBase58()
    }, 'Found Raydium pool');

    return {
      mint: mint.toBase58(),
      poolAddress: poolAddress.toBase58(),
      baseVault: baseVault.toBase58(),
      quoteVault: quoteVault.toBase58(),
      poolType: 'raydium'
    };
  } catch (error) {
    logger.debug({ error }, 'Not a Raydium pool');
    return null;
  }
}

/**
 * Load tokens from TOKENS env variable and discover their pools
 */
export async function loadTokensFromEnv(connection: Connection): Promise<PoolInfo[]> {
  const tokensEnv = process.env.TOKENS;
  if (!tokensEnv) {
    logger.warn('No TOKENS variable in .env file');
    return [];
  }

  const mints = tokensEnv.split(',').map(t => t.trim()).filter(Boolean);
  logger.info({ count: mints.length }, 'Loading tokens from .env');

  const results: PoolInfo[] = [];
  for (const mint of mints) {
    const poolInfo = await discoverPoolInfo(connection, mint);
    if (poolInfo) {
      results.push(poolInfo);
    } else {
      logger.warn({ mint }, 'Could not discover pool for token');
    }
  }

  return results;
}
