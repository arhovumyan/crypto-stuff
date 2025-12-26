#!/usr/bin/env node
/**
 * CLI: Replay simulation
 * Usage: npm run replay -- --input swaps_2025-12-26.jsonl --speed 10x --output ./output
 */

import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SimulationCoordinator } from '../sandbox/simulation-coordinator.js';
import {
  ReplayConfig,
  DEFAULT_SCENARIO_CONFIG,
  DEFAULT_EXECUTION_CONFIG,
  IDEALIZED_EXECUTION_CONFIG,
  STRESS_EXECUTION_CONFIG,
} from '../sandbox/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from project root
dotenv.config({ path: resolve(__dirname, '../../../../.env') });

async function main() {
  const args = process.argv.slice(2);
  
  // Parse arguments
  let datasetPath = '';
  let speed: '1x' | '10x' | '100x' | 'max' = '10x';
  let outputDir = './simulation-output';
  let executionMode: 'idealized' | 'realistic' | 'stress' = 'realistic';
  let startingCapitalSOL = 10;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input') {
      datasetPath = args[++i];
    } else if (args[i] === '--speed') {
      speed = args[++i] as any;
    } else if (args[i] === '--output') {
      outputDir = args[++i];
    } else if (args[i] === '--mode') {
      executionMode = args[++i] as any;
    } else if (args[i] === '--capital') {
      startingCapitalSOL = parseFloat(args[++i]);
    }
  }

  if (!datasetPath) {
    console.error('❌ Error: --input dataset path is required');
    console.log('Usage: npm run replay -- --input swaps_2025-12-26.jsonl --speed 10x');
    process.exit(1);
  }

  console.log('🎮 Starting replay simulation');
  console.log(`Dataset: ${datasetPath}`);
  console.log(`Speed: ${speed}`);
  console.log(`Output: ${outputDir}`);
  console.log(`Execution mode: ${executionMode}`);
  console.log(`Starting capital: ${startingCapitalSOL} SOL`);

  // Build config
  const config: ReplayConfig = {
    datasetPath,
    speed,
    outputDir,
    scenario: DEFAULT_SCENARIO_CONFIG,
    execution: executionMode === 'idealized' ? IDEALIZED_EXECUTION_CONFIG :
               executionMode === 'stress' ? STRESS_EXECUTION_CONFIG :
               DEFAULT_EXECUTION_CONFIG,
    startingCapitalSOL,
    maxPositionSizeSOL: 1,
    maxConcurrentPositions: 3,
    riskPerTradePct: 2,
    enableDetailedLogging: true,
  };

  const dbConnectionString = process.env.DATABASE_URL!;

  // Create coordinator
  const coordinator = new SimulationCoordinator(config, dbConnectionString);

  // Listen for progress
  setInterval(() => {
    const progress = coordinator.getProgress();
    if (progress.total > 0) {
      console.log(`Progress: ${progress.current}/${progress.total} (${progress.percentage.toFixed(1)}%)`);
    }
  }, 5000);

  // Run simulation
  coordinator.on('complete', (runId) => {
    console.log(`✅ Simulation complete: ${runId}`);
    console.log(`Reports saved to: ${outputDir}`);
    process.exit(0);
  });

  coordinator.on('error', (error) => {
    console.error(`❌ Simulation failed: ${error.message}`);
    process.exit(1);
  });

  await coordinator.run();
}

main().catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
});

