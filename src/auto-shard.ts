import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { execSync, spawn } from 'child_process';
import { EventEmitter } from 'events';

interface ShardConfig {
  totalShards: number;
  testPaths: string[];
  projectRoot: string;
  jestConfig?: string;
  maxParallel?: number;
  timeout?: number;
}

interface ShardStatus {
  shardId: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  pid?: number;
  startTime?: number;
  endTime?: number;
  exitCode?: number;
}

export class AutoShardCoordinator extends EventEmitter {
  private lockDir: string;
  private statusFile: string;
  private config: ShardConfig;
  private shardStatuses: Map<number, ShardStatus> = new Map();
  private maxRetries: number = 2;

  constructor(config: ShardConfig) {
    super();
    this.config = config;

    // Use a temp directory for coordination files
    const tmpBase = os.tmpdir();
    const projectHash = crypto
      .createHash('md5')
      .update(config.projectRoot)
      .digest('hex')
      .substring(0, 8);

    this.lockDir = path.join(tmpBase, `jest-shard-${projectHash}`);
    this.statusFile = path.join(this.lockDir, 'shard-status.json');

    this.ensureLockDir();
  }

  private ensureLockDir(): void {
    if (!fs.existsSync(this.lockDir)) {
      fs.mkdirSync(this.lockDir, { recursive: true });
    }
  }

  private readStatus(): Record<number, ShardStatus> {
    try {
      if (fs.existsSync(this.statusFile)) {
        return JSON.parse(fs.readFileSync(this.statusFile, 'utf8'));
      }
    } catch (error) {
      console.warn('Could not read shard status:', error);
    }
    return {};
  }

  private writeStatus(statuses: Record<number, ShardStatus>): void {
    try {
      fs.writeFileSync(this.statusFile, JSON.stringify(statuses, null, 2));
    } catch (error) {
      console.warn('Could not write shard status:', error);
    }
  }

  private acquireShardLock(shardId: number): boolean {
    const lockFile = path.join(this.lockDir, `shard-${shardId}.lock`);

    try {
      // Try to create lock file exclusively
      fs.writeFileSync(lockFile, JSON.stringify({
        pid: process.pid,
        timestamp: Date.now(),
        hostname: os.hostname()
      }), { flag: 'wx' });

      return true;
    } catch (error: any) {
      if (error.code === 'EEXIST') {
        // Lock file exists, check if process is still running
        try {
          const lockData = JSON.parse(fs.readFileSync(lockFile, 'utf8'));

          // Check if lock is stale (older than 5 minutes)
          if (Date.now() - lockData.timestamp > 300000) {
            fs.unlinkSync(lockFile);
            return this.acquireShardLock(shardId);
          }

          // Check if process is still running (Unix-like systems)
          if (process.platform !== 'win32') {
            try {
              process.kill(lockData.pid, 0);
              // Process exists
              return false;
            } catch {
              // Process doesn't exist, remove stale lock
              fs.unlinkSync(lockFile);
              return this.acquireShardLock(shardId);
            }
          }
        } catch {
          // Corrupted lock file, remove and retry
          try {
            fs.unlinkSync(lockFile);
            return this.acquireShardLock(shardId);
          } catch {
            return false;
          }
        }
      }
      return false;
    }
  }

  private releaseShardLock(shardId: number): void {
    const lockFile = path.join(this.lockDir, `shard-${shardId}.lock`);
    try {
      fs.unlinkSync(lockFile);
    } catch {
      // Ignore errors
    }
  }

  public async determineNextAvailableShard(): Promise<number | null> {
    const statuses = this.readStatus();

    // Initialize status for all shards if needed
    for (let i = 1; i <= this.config.totalShards; i++) {
      if (!statuses[i]) {
        statuses[i] = { shardId: i, status: 'pending' };
      }
    }

    // Find next available shard
    for (let i = 1; i <= this.config.totalShards; i++) {
      const status = statuses[i];

      if (status.status === 'pending' || status.status === 'failed') {
        if (this.acquireShardLock(i)) {
          status.status = 'running';
          status.pid = process.pid;
          status.startTime = Date.now();

          this.writeStatus(statuses);
          this.shardStatuses.set(i, status);

          return i;
        }
      }
    }

    return null;
  }

  public markShardComplete(shardId: number, exitCode: number = 0): void {
    const statuses = this.readStatus();

    if (statuses[shardId]) {
      statuses[shardId].status = exitCode === 0 ? 'completed' : 'failed';
      statuses[shardId].endTime = Date.now();
      statuses[shardId].exitCode = exitCode;

      this.writeStatus(statuses);
      this.releaseShardLock(shardId);
    }
  }

  public getShardStatus(): { completed: number; running: number; pending: number; failed: number } {
    const statuses = this.readStatus();
    const result = { completed: 0, running: 0, pending: 0, failed: 0 };

    for (const status of Object.values(statuses)) {
      result[status.status]++;
    }

    return result;
  }

  public cleanup(): void {
    // Clean up all locks and status files
    try {
      if (fs.existsSync(this.lockDir)) {
        const files = fs.readdirSync(this.lockDir);
        for (const file of files) {
          fs.unlinkSync(path.join(this.lockDir, file));
        }
        fs.rmdirSync(this.lockDir);
      }
    } catch (error) {
      console.warn('Could not cleanup shard locks:', error);
    }
  }

  public async runAllShards(options: {
    maxParallel?: number;
    onShardComplete?: (shardId: number, exitCode: number) => void;
  } = {}): Promise<void> {
    const maxParallel = options.maxParallel || this.config.maxParallel || os.cpus().length;
    const runningShards = new Map<number, any>();

    // Clean up previous run
    this.cleanup();
    this.ensureLockDir();

    return new Promise((resolve, reject) => {
      const checkAndStartShards = () => {
        // Start new shards if below parallel limit
        while (runningShards.size < maxParallel) {
          const statuses = this.readStatus();
          let nextShard: number | null = null;

          // Find next pending shard
          for (let i = 1; i <= this.config.totalShards; i++) {
            if (!statuses[i] || statuses[i].status === 'pending') {
              if (this.acquireShardLock(i)) {
                nextShard = i;
                break;
              }
            }
          }

          if (!nextShard) {
            // Check if all shards are complete
            if (runningShards.size === 0) {
              const status = this.getShardStatus();
              if (status.pending === 0 && status.running === 0) {
                resolve();
              }
            }
            return;
          }

          // Start shard
          console.log(`Starting shard ${nextShard}/${this.config.totalShards}`);

          const env = {
            ...process.env,
            JEST_TOTAL_SHARDS: this.config.totalShards.toString(),
            JEST_SHARD_INDEX: nextShard.toString(),
            JEST_AUTO_SHARD: 'true'
          };

          const args = [
            '--shard',
            `${nextShard}/${this.config.totalShards}`
          ];

          if (this.config.jestConfig) {
            args.push('--config', this.config.jestConfig);
          }

          const child = spawn('npx', ['jest', ...args], {
            env,
            stdio: 'inherit',
            shell: true
          });

          runningShards.set(nextShard, child);

          // Update status
          const newStatuses = this.readStatus();
          newStatuses[nextShard] = {
            shardId: nextShard,
            status: 'running',
            pid: child.pid,
            startTime: Date.now()
          };
          this.writeStatus(newStatuses);

          child.on('exit', (code) => {
            const exitCode = code || 0;
            console.log(`Shard ${nextShard}/${this.config.totalShards} completed with code ${exitCode}`);

            // Update status
            this.markShardComplete(nextShard!, exitCode);

            // Clean up
            runningShards.delete(nextShard!);
            this.releaseShardLock(nextShard!);

            if (options.onShardComplete) {
              options.onShardComplete(nextShard!, exitCode);
            }

            // Check for more work
            setImmediate(checkAndStartShards);
          });
        }
      };

      // Start initial shards
      checkAndStartShards();
    });
  }
}

export class AutoShardRunner {
  private coordinator: AutoShardCoordinator;

  constructor(private config: {
    totalShards?: number;
    jestConfig?: string;
    projectRoot?: string;
    maxParallel?: number;
  } = {}) {
    const projectRoot = config.projectRoot || process.cwd();
    const totalShards = config.totalShards || this.detectOptimalShardCount();

    // Get test paths from Jest
    const testPaths = this.getTestPaths(projectRoot, config.jestConfig);

    this.coordinator = new AutoShardCoordinator({
      totalShards,
      testPaths,
      projectRoot,
      jestConfig: config.jestConfig,
      maxParallel: config.maxParallel
    });
  }

  private detectOptimalShardCount(): number {
    const cpuCount = os.cpus().length;
    const testCount = this.estimateTestCount();

    // Heuristic: Use CPU count, but cap at test file count / 10
    const maxShards = Math.max(1, Math.floor(testCount / 10));
    return Math.min(cpuCount, maxShards, 8); // Cap at 8 shards max
  }

  private estimateTestCount(): number {
    try {
      const output = execSync('npx jest --listTests', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore']
      });

      return output.split('\n').filter(line => line.trim()).length;
    } catch {
      // Default to 4 shards if we can't get test count
      return 40;
    }
  }

  private getTestPaths(projectRoot: string, jestConfig?: string): string[] {
    try {
      const args = ['jest', '--listTests'];
      if (jestConfig) {
        args.push('--config', jestConfig);
      }

      const output = execSync(`npx ${args.join(' ')}`, {
        encoding: 'utf8',
        cwd: projectRoot,
        stdio: ['pipe', 'pipe', 'ignore']
      });

      return output.split('\n').filter(line => line.trim());
    } catch {
      return [];
    }
  }

  public async run(): Promise<void> {
    const totalShards = this.config.totalShards || this.detectOptimalShardCount();

    console.log(`🚀 Auto-sharding tests across ${totalShards} shards`);
    console.log(`📦 Max parallel shards: ${this.config.maxParallel || os.cpus().length}`);

    await this.coordinator.runAllShards({
      maxParallel: this.config.maxParallel,
      onShardComplete: (shardId, exitCode) => {
        if (exitCode !== 0) {
          console.error(`❌ Shard ${shardId} failed with exit code ${exitCode}`);
        }
      }
    });

    // Merge coverage after all shards complete
    console.log('\n📊 Merging coverage reports...');
    const { mergeCoverageReports } = require('./index');
    await mergeCoverageReports();

    console.log('✅ All shards completed successfully!');

    // Cleanup
    this.coordinator.cleanup();
  }

  public async runSingleShard(): Promise<number> {
    const shardId = await this.coordinator.determineNextAvailableShard();

    if (!shardId) {
      console.log('No shards available to run');
      return 0;
    }

    console.log(`Running as shard ${shardId}/${this.config.totalShards || this.detectOptimalShardCount()}`);

    // Set environment variables for Jest
    process.env.JEST_SHARD_INDEX = shardId.toString();
    process.env.JEST_TOTAL_SHARDS = (this.config.totalShards || this.detectOptimalShardCount()).toString();
    process.env.JEST_AUTO_SHARD = 'true';

    return shardId;
  }
}