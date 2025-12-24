import WebSocket from 'ws';
import { createLogger } from '@copytrader/shared';

const logger = createLogger('websocket-manager');

export class WebSocketManager {
  private ws: WebSocket | null = null;
  private subscriptions: Map<string, number> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private isIntentionallyClosed = false;
  private messageHandlers: ((message: any) => void)[] = [];

  constructor(private url: string) {}

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      logger.info({ url: this.url }, 'Connecting to WebSocket...');

      this.ws = new WebSocket(this.url);

      this.ws.on('open', () => {
        logger.info('WebSocket connected successfully');
        this.reconnectAttempts = 0;
        resolve();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(message);
        } catch (error) {
          logger.error({ error, data: data.toString() }, 'Failed to parse message');
        }
      });

      this.ws.on('error', (error) => {
        logger.error({ error }, 'WebSocket error');
        reject(error);
      });

      this.ws.on('close', (code, reason) => {
        logger.warn({ code, reason: reason.toString() }, 'WebSocket closed');
        this.ws = null;

        if (!this.isIntentionallyClosed) {
          this.attemptReconnect();
        }
      });

      this.ws.on('ping', () => {
        logger.debug('Received ping from server');
      });
    });
  }

  private handleMessage(message: any): void {
    // Route message to all registered handlers
    this.messageHandlers.forEach(handler => {
      try {
        handler(message);
      } catch (error) {
        logger.error({ error, message }, 'Message handler error');
      }
    });
  }

  public onMessage(handler: (message: any) => void): void {
    this.messageHandlers.push(handler);
  }

  private async attemptReconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('Max reconnection attempts reached. Giving up.');
      process.exit(1);
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    
    logger.info(
      { attempt: this.reconnectAttempts, delayMs: delay },
      'Attempting to reconnect...'
    );

    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      await this.connect();
      
      // Re-subscribe to all previous subscriptions
      logger.info('Reconnected. Re-subscribing to all accounts...');
      const addresses = Array.from(this.subscriptions.keys());
      this.subscriptions.clear();
      
      for (const address of addresses) {
        await this.subscribeToAccount(address);
      }
    } catch (error) {
      logger.error({ error }, 'Reconnection failed');
      this.attemptReconnect();
    }
  }

  async subscribeToAccount(address: string): Promise<number> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }

    // Check if already subscribed
    if (this.subscriptions.has(address)) {
      logger.debug({ address }, 'Already subscribed to account');
      return this.subscriptions.get(address)!;
    }

    const subscriptionId = Math.floor(Math.random() * 1000000);
    
    const subscribeRequest = {
      jsonrpc: '2.0',
      id: subscriptionId,
      method: 'logsSubscribe',
      params: [
        {
          mentions: [address]
        },
        {
          commitment: 'confirmed'
        }
      ]
    };

    logger.info({ address, subscriptionId }, 'Subscribing to account logs');
    this.ws.send(JSON.stringify(subscribeRequest));
    
    this.subscriptions.set(address, subscriptionId);
    return subscriptionId;
  }

  async unsubscribeFromAccount(address: string): Promise<void> {
    const subscriptionId = this.subscriptions.get(address);
    if (!subscriptionId) {
      logger.warn({ address }, 'No subscription found for address');
      return;
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      logger.warn('WebSocket not connected, cannot unsubscribe');
      return;
    }

    const unsubscribeRequest = {
      jsonrpc: '2.0',
      id: Math.floor(Math.random() * 1000000),
      method: 'logsUnsubscribe',
      params: [subscriptionId]
    };

    this.ws.send(JSON.stringify(unsubscribeRequest));
    this.subscriptions.delete(address);
    
    logger.info({ address, subscriptionId }, 'Unsubscribed from account');
  }

  async close(): Promise<void> {
    this.isIntentionallyClosed = true;
    
    if (this.ws) {
      logger.info('Closing WebSocket connection...');
      this.ws.close();
      this.ws = null;
    }
    
    this.subscriptions.clear();
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  getSubscriptions(): string[] {
    return Array.from(this.subscriptions.keys());
  }
}
