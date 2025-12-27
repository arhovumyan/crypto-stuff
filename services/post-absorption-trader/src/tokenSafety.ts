import { Connection, PublicKey } from '@solana/web3.js';
import { config } from './config';
import { logger } from './logger';
import { getMint, getAccount } from '@solana/spl-token';

interface TokenSafetyCheck {
  passed: boolean;
  reason?: string;
}

interface TokenSafetyResult {
  safe: boolean;
  checks: {
    freezeAuthority: TokenSafetyCheck;
    mintAuthority: TokenSafetyCheck;
    holderConcentration: TokenSafetyCheck;
    tokenAge: TokenSafetyCheck;
    transactionCount: TokenSafetyCheck;
  };
  warnings: string[];
}

export class TokenSafetyChecker {
  private connection: Connection;

  constructor() {
    this.connection = new Connection(config.rpcUrl, 'confirmed');
  }

  /**
   * Perform comprehensive token safety checks
   */
  async checkToken(tokenMint: string): Promise<TokenSafetyResult> {
    logger.info(`[TokenSafety] 🔍 Checking token: ${tokenMint.slice(0, 8)}...`);

    const result: TokenSafetyResult = {
      safe: true,
      checks: {
        freezeAuthority: { passed: false },
        mintAuthority: { passed: false },
        holderConcentration: { passed: false },
        tokenAge: { passed: false },
        transactionCount: { passed: false },
      },
      warnings: [],
    };

    try {
      const mintPubkey = new PublicKey(tokenMint);

      // Check 1: Freeze Authority
      result.checks.freezeAuthority = await this.checkFreezeAuthority(mintPubkey);
      
      // Check 2: Mint Authority
      result.checks.mintAuthority = await this.checkMintAuthority(mintPubkey);
      
      // Check 3: Holder Concentration
      result.checks.holderConcentration = await this.checkHolderConcentration(mintPubkey);
      
      // Check 4: Token Age
      result.checks.tokenAge = await this.checkTokenAge(mintPubkey);
      
      // Check 5: Transaction Count
      result.checks.transactionCount = await this.checkTransactionCount(mintPubkey);

      // Determine overall safety
      const criticalChecks = [
        result.checks.freezeAuthority,
        result.checks.mintAuthority,
      ];

      const importantChecks = [
        result.checks.holderConcentration,
        result.checks.tokenAge,
        result.checks.transactionCount,
      ];

      // Must pass ALL critical checks
      const criticalPassed = criticalChecks.every(c => c.passed);
      if (!criticalPassed) {
        result.safe = false;
        result.warnings.push('Failed critical safety checks (freeze/mint authority)');
      }

      // Should pass at least 2/3 important checks
      const importantPassed = importantChecks.filter(c => c.passed).length;
      if (importantPassed < 2) {
        result.safe = false;
        result.warnings.push(`Only ${importantPassed}/3 important checks passed`);
      }

      // Log result
      const status = result.safe ? '✅ SAFE' : '❌ UNSAFE';
      const checkStatus = Object.entries(result.checks)
        .map(([name, check]) => `${check.passed ? '✅' : '❌'} ${name}`)
        .join(', ');

      logger.info(`[TokenSafety] ${status} ${tokenMint.slice(0, 8)}... | ${checkStatus}`);

      if (result.warnings.length > 0) {
        result.warnings.forEach(w => logger.warn(`[TokenSafety] ⚠️  ${w}`));
      }

    } catch (err) {
      logger.error(`[TokenSafety] Error checking token ${tokenMint}:`, err);
      result.safe = false;
      result.warnings.push(`Error during safety checks: ${err}`);
    }

    return result;
  }

  /**
   * Check if freeze authority is revoked
   */
  private async checkFreezeAuthority(mintPubkey: PublicKey): Promise<TokenSafetyCheck> {
    try {
      const mintInfo = await getMint(this.connection, mintPubkey);
      
      if (mintInfo.freezeAuthority === null) {
        return { passed: true };
      }

      return {
        passed: !config.tokenSafety.requireNoFreezeAuthority,
        reason: `Freeze authority present: ${mintInfo.freezeAuthority.toBase58()}`,
      };
    } catch (err) {
      logger.warn('[TokenSafety] Freeze authority check failed:', err);
      return {
        passed: false,
        reason: `Could not verify freeze authority: ${err}`,
      };
    }
  }

  /**
   * Check if mint authority is revoked or has reasonable supply cap
   */
  private async checkMintAuthority(mintPubkey: PublicKey): Promise<TokenSafetyCheck> {
    try {
      const mintInfo = await getMint(this.connection, mintPubkey);
      
      if (mintInfo.mintAuthority === null) {
        return { passed: true };
      }

      // If mint authority exists, check if it's reasonable
      // (some tokens have mint authority but capped supply)
      const currentSupply = Number(mintInfo.supply) / Math.pow(10, mintInfo.decimals);
      
      // If supply is already large (>1B tokens), less risky
      if (currentSupply > 1_000_000_000) {
        return {
          passed: true,
          reason: `Mint authority present but large supply (${currentSupply.toLocaleString()})`,
        };
      }

      return {
        passed: !config.tokenSafety.requireNoMintAuthority,
        reason: `Mint authority present with supply: ${currentSupply.toLocaleString()}`,
      };
    } catch (err) {
      logger.warn('[TokenSafety] Mint authority check failed:', err);
      return {
        passed: false,
        reason: `Could not verify mint authority: ${err}`,
      };
    }
  }

  /**
   * Check top holder concentration (via Helius API)
   */
  private async checkHolderConcentration(mintPubkey: PublicKey): Promise<TokenSafetyCheck> {
    try {
      // Query top token holders
      const response = await fetch(`${config.rpcUrl}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'holder-check',
          method: 'getTokenLargestAccounts',
          params: [mintPubkey.toBase58()],
        }),
      });

      const data = await response.json() as any;
      
      if (data.error) {
        throw new Error(data.error.message);
      }

      const accounts = data.result?.value || [];
      
      if (accounts.length === 0) {
        return {
          passed: false,
          reason: 'No holder data available',
        };
      }

      // Get total supply
      const mintInfo = await getMint(this.connection, mintPubkey);
      const totalSupply = Number(mintInfo.supply);

      // Calculate top holder %
      const topHolderAmount = Number(accounts[0].amount);
      const topHolderPercent = (topHolderAmount / totalSupply) * 100;

      if (topHolderPercent <= config.tokenSafety.maxTopHolderPercent) {
        return { passed: true };
      }

      return {
        passed: false,
        reason: `Top holder owns ${topHolderPercent.toFixed(1)}% (max: ${config.tokenSafety.maxTopHolderPercent}%)`,
      };

    } catch (err) {
      logger.warn('[TokenSafety] Holder concentration check failed:', err);
      // Don't fail hard on this check - API might be down
      return {
        passed: true,
        reason: `Could not verify holder concentration (skipped): ${err}`,
      };
    }
  }

  /**
   * Check token age via first transaction
   */
  private async checkTokenAge(mintPubkey: PublicKey): Promise<TokenSafetyCheck> {
    try {
      // Get first transaction signature for the mint account
      const signatures = await this.connection.getSignaturesForAddress(
        mintPubkey,
        { limit: 1 },
        'confirmed'
      );

      if (signatures.length === 0) {
        return {
          passed: false,
          reason: 'No transaction history found',
        };
      }

      // Get the earliest transaction time
      const firstTxTime = signatures[0].blockTime;
      if (!firstTxTime) {
        return {
          passed: false,
          reason: 'Could not determine token age',
        };
      }

      const ageSeconds = Date.now() / 1000 - firstTxTime;
      const ageMinutes = ageSeconds / 60;
      const ageHours = ageMinutes / 60;

      if (ageSeconds >= config.tokenSafety.minTokenAgeSec) {
        return {
          passed: true,
          reason: `Token age: ${ageHours.toFixed(1)}h`,
        };
      }

      return {
        passed: false,
        reason: `Token too new: ${ageMinutes.toFixed(0)}m (min: ${config.tokenSafety.minTokenAgeSec / 60}m)`,
      };

    } catch (err) {
      logger.warn('[TokenSafety] Token age check failed:', err);
      return {
        passed: false,
        reason: `Could not verify token age: ${err}`,
      };
    }
  }

  /**
   * Check transaction count
   */
  private async checkTransactionCount(mintPubkey: PublicKey): Promise<TokenSafetyCheck> {
    try {
      // Get recent signatures to estimate activity
      const signatures = await this.connection.getSignaturesForAddress(
        mintPubkey,
        { limit: 1000 },
        'confirmed'
      );

      const txCount = signatures.length;

      if (txCount >= config.tokenSafety.minTxCount) {
        return {
          passed: true,
          reason: `${txCount} transactions`,
        };
      }

      return {
        passed: false,
        reason: `Only ${txCount} transactions (min: ${config.tokenSafety.minTxCount})`,
      };

    } catch (err) {
      logger.warn('[TokenSafety] Transaction count check failed:', err);
      return {
        passed: false,
        reason: `Could not verify transaction count: ${err}`,
      };
    }
  }
}
