/**
 * API Server for 10 Dollar Monster
 * REST API to control the monitoring service
 */

import express from 'express';
import cors from 'cors';
import { TenDollarMonster } from './ten-dollar-monster.js';
import { PurchaseTracker } from './purchase-tracker.js';
import pino from 'pino';
import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, '../../../.env') });

const app = express();
const PORT = process.env.PORT || 3001;

const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'yyyy-mm-dd HH:MM:ss Z',
      ignore: 'pid,hostname',
    },
  },
});

// Middleware
app.use(cors());
app.use(express.json());

// State
let monsterService: TenDollarMonster | null = null;
let isMonitoring = false;
let purchaseTracker: PurchaseTracker;

// Initialize purchase tracker
purchaseTracker = new PurchaseTracker(process.env.DATABASE_URL || '');

/**
 * GET /api/status
 * Get current service status
 */
app.get('/api/status', async (req, res) => {
  try {
    const watchAddresses = (process.env.WATCH_ADDRESSES || '').split(',').filter(a => a.trim());
    
    res.json({
      isMonitoring,
      config: {
        watchAddresses,
        purchaseAmountSOL: 10,
        checkInterval: '60 seconds',
        enableLiveTrading: process.env.ENABLE_LIVE_TRADING === 'true',
      },
    });
  } catch (error: any) {
    logger.error({ error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/start
 * Start monitoring wallets
 */
app.post('/api/start', async (req, res) => {
  try {
    if (isMonitoring) {
      return res.status(400).json({ error: 'Service is already monitoring' });
    }

    const { watchAddresses } = req.body;
    
    // Update watch addresses if provided
    if (watchAddresses && Array.isArray(watchAddresses)) {
      process.env.WATCH_ADDRESSES = watchAddresses.join(',');
    }

    monsterService = new TenDollarMonster();
    await monsterService.start();
    isMonitoring = true;

    logger.info('Monitoring started via API');
    
    res.json({
      success: true,
      message: 'Monitoring started',
      watchAddresses: (process.env.WATCH_ADDRESSES || '').split(',').filter(a => a.trim()),
    });
  } catch (error: any) {
    logger.error({ error: error.message });
    isMonitoring = false;
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/stop
 * Stop monitoring wallets
 */
app.post('/api/stop', async (req, res) => {
  try {
    if (!isMonitoring || !monsterService) {
      return res.status(400).json({ error: 'Service is not monitoring' });
    }

    monsterService.stop();
    monsterService = null;
    isMonitoring = false;

    logger.info('Monitoring stopped via API');
    
    res.json({
      success: true,
      message: 'Monitoring stopped',
    });
  } catch (error: any) {
    logger.error({ error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/purchases
 * Get purchase history
 */
app.get('/api/purchases', async (req, res) => {
  try {
    await purchaseTracker.ensureTable();
    const purchases = await purchaseTracker.getAllPurchases();
    
    res.json({
      success: true,
      purchases,
      count: purchases.length,
    });
  } catch (error: any) {
    logger.error({ error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/config
 * Update configuration
 */
app.put('/api/config', async (req, res) => {
  try {
    const { watchAddresses, enableLiveTrading } = req.body;

    if (isMonitoring) {
      return res.status(400).json({ 
        error: 'Cannot update config while monitoring. Stop the service first.' 
      });
    }

    if (watchAddresses) {
      process.env.WATCH_ADDRESSES = Array.isArray(watchAddresses) 
        ? watchAddresses.join(',')
        : watchAddresses;
    }

    if (enableLiveTrading !== undefined) {
      process.env.ENABLE_LIVE_TRADING = enableLiveTrading ? 'true' : 'false';
    }

    res.json({
      success: true,
      message: 'Configuration updated',
      config: {
        watchAddresses: (process.env.WATCH_ADDRESSES || '').split(',').filter(a => a.trim()),
        enableLiveTrading: process.env.ENABLE_LIVE_TRADING === 'true',
      },
    });
  } catch (error: any) {
    logger.error({ error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /health
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  logger.info(`API Server running on port ${PORT}`);
  logger.info(`Health check: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  logger.info('Shutting down gracefully...');
  if (monsterService) {
    monsterService.stop();
  }
  process.exit(0);
});
