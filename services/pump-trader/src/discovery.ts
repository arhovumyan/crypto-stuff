/**
 * Pump.fun Token Discovery
 * Monitors Helius WebSocket for new Pump.fun token creations
 */

import WebSocket from 'ws';
import axios from 'axios';
import { config } from './config';
import { Logger } from './logger';

export interface TokenCreationEvent {
  mint: string;
  signature: string;
  timestamp: Date;
}

export class PumpfunDiscovery {
  private ws?: WebSocket;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private reconnectDelay: number = 5000;
  private isShuttingDown: boolean = false;

  /**
   * Start listening for new Pump.fun tokens
   */
  async start(onTokenCreated: (event: TokenCreationEvent) => void): Promise<void> {
    await this.connect(onTokenCreated);
  }

  /**
   * Connect to Helius WebSocket
   */
  private async connect(onTokenCreated: (event: TokenCreationEvent) => void): Promise<void> {
    if (this.isShuttingDown) return;

    try {
      this.ws = new WebSocket(config.heliusWsUrl);

      this.ws.on('open', () => {
        this.reconnectAttempts = 0;
        Logger.websocketConnected();

        // Subscribe to all program logs for Pump.fun
        // This will catch ALL transactions involving the Pump.fun program
        const subscribeMessage = {
          jsonrpc: '2.0',
          id: 1,
          method: 'logsSubscribe',
          params: [
            {
              mentions: [config.pumpfunProgramId],
            },
            {
              commitment: 'confirmed',
            },
          ],
        };

        this.ws?.send(JSON.stringify(subscribeMessage));
        
        Logger.debug('Subscribed to Pump.fun program logs', {
          programId: config.pumpfunProgramId,
        });
      });

      this.ws.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          
          // Log raw message for debugging
          Logger.debug('WebSocket message received', {
            method: message.method,
            hasParams: !!message.params,
          });
          
          if (message.method === 'logsNotification') {
            this.handleLogNotification(message.params, onTokenCreated);
          }
        } catch (error: any) {
          Logger.debug('Error parsing WebSocket message', { error: error.message });
        }
      });

      this.ws.on('error', (error) => {
        Logger.error('WebSocket error', error);
      });

      this.ws.on('close', () => {
        if (!this.isShuttingDown) {
          this.handleReconnect(onTokenCreated);
        }
      });

    } catch (error: any) {
      Logger.error('Failed to connect to WebSocket', error);
      this.handleReconnect(onTokenCreated);
    }
  }

  /**
   * Handle log notification from Helius
   */
  private handleLogNotification(params: any, onTokenCreated: (event: TokenCreationEvent) => void): void {
    try {
      const result = params.result;
      if (!result || !result.value) return;

      const logs = result.value.logs || [];
      const signature = result.value.signature;

      // Look for token creation indicators in logs
      const hasCreateInstruction = logs.some((log: string) => 
        log.includes('Instruction: Create') ||
        log.includes('create') ||
        log.toLowerCase().includes('initialize')
      );

      if (hasCreateInstruction) {
        Logger.debug('Potential Pump.fun transaction detected', {
          signature,
          logCount: logs.length,
          sampleLogs: logs.slice(0, 3),
        });

        // Try to extract mint address from the transaction
        // We need to fetch the full transaction to get account keys
        this.fetchTransactionAndExtractMint(signature, onTokenCreated);
      }

    } catch (error: any) {
      Logger.debug('Error handling log notification', { error: error.message });
    }
  }

  /**
   * Fetch full transaction data to extract mint address
   */
  private async fetchTransactionAndExtractMint(
    signature: string,
    onTokenCreated: (event: TokenCreationEvent) => void
  ): Promise<void> {
    try {
      const response = await axios.post(
        config.heliusRpcUrl,
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'getTransaction',
          params: [
            signature,
            {
              encoding: 'jsonParsed',
              maxSupportedTransactionVersion: 0,
            },
          ],
        },
        { timeout: 5000 }
      );

      if (!response.data?.result) {
        Logger.debug('Could not fetch transaction', { signature });
        return;
      }

      const tx = response.data.result;
      const accountKeys = tx.transaction?.message?.accountKeys || [];

      // Look for newly created token mint accounts
      // Pump.fun creates SPL tokens, so look for Token Program interactions
      let potentialMint: string | null = null;

      // Method 1: Look in account keys for new mints
      for (const account of accountKeys) {
        const pubkey = typeof account === 'string' ? account : account.pubkey;
        if (pubkey && pubkey !== config.pumpfunProgramId && pubkey.length >= 32) {
          // This could be the mint - we'll verify with the tracker
          potentialMint = pubkey;
          break;
        }
      }

      if (potentialMint) {
        Logger.debug('Extracted potential mint address', {
          mint: potentialMint,
          signature,
        });

        const event: TokenCreationEvent = {
          mint: potentialMint,
          signature,
          timestamp: new Date(),
        };

        onTokenCreated(event);
      } else {
        Logger.debug('Could not extract mint from transaction', { signature });
      }

    } catch (error: any) {
      Logger.debug('Error fetching transaction', {
        signature,
        error: error.message,
      });
    }
  }

  /**
   * Handle reconnection logic
   */
  private handleReconnect(onTokenCreated: (event: TokenCreationEvent) => void): void {
    if (this.isShuttingDown) return;

    this.reconnectAttempts++;

    if (this.reconnectAttempts > this.maxReconnectAttempts) {
      Logger.error('Max reconnection attempts reached', new Error('WebSocket connection failed'));
      return;
    }

    Logger.websocketReconnecting(this.reconnectAttempts);

    setTimeout(() => {
      this.connect(onTokenCreated);
    }, this.reconnectDelay * this.reconnectAttempts);
  }

  /**
   * Stop listening and close connection
   */
  stop(): void {
    this.isShuttingDown = true;
    
    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }
  }
}
