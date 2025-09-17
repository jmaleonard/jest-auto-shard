import type { Config } from '@jest/types';
import type {
  AggregatedResult,
  Test,
  TestResult,
  TestContext,
  Reporter,
  ReporterOnStartOptions
} from '@jest/reporters';
import { ShardReporterOptions, ShardInfo } from './types';
import { CoverageCollector } from './coverage-merger';
import { SmartStrategy } from './sharding-strategy';
import { AutoShardRunner } from './auto-shard';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

export class JestShardReporter implements Reporter {
  private globalConfig: Config.GlobalConfig;
  private options: ShardReporterOptions;
  private shardInfo: ShardInfo;
  private coverageCollector: CoverageCollector;
  private startTime: number = 0;
  private shardingStrategy: SmartStrategy;
  private testDurations: Map<string, number> = new Map();
  private isAutoShard: boolean = false;

  constructor(globalConfig: Config.GlobalConfig, options: ShardReporterOptions = {}) {
    this.globalConfig = globalConfig;
    this.options = {
      coverageDirectory: process.env.JEST_COVERAGE_DIR || 'coverage',
      shardedCoverageDir: process.env.JEST_SHARD_COVERAGE_DIR || 'coverage-shards',
      finalCoverageDir: process.env.JEST_FINAL_COVERAGE_DIR || 'coverage-final',
      verbose: false,
      reportFormats: ['html', 'text', 'lcov', 'json'],
      cleanupShardFiles: false,
      mergeCoverageOnComplete: true,
      ...options
    };

    // Check if running in auto-shard mode
    this.isAutoShard = process.env.JEST_AUTO_SHARD === 'true';

    // Auto-detect shard info if not provided
    if (this.isAutoShard && !process.env.JEST_SHARD_INDEX) {
      // Try to auto-assign a shard
      this.autoAssignShard();
    }

    this.shardInfo = {
      index: parseInt(process.env.JEST_SHARD_INDEX || this.options.shardIndex?.toString() || '1'),
      total: parseInt(process.env.JEST_TOTAL_SHARDS || this.options.totalShards?.toString() || '1')
    };

    this.coverageCollector = new CoverageCollector({
      shardedCoverageDir: this.options.shardedCoverageDir,
      finalCoverageDir: this.options.finalCoverageDir,
      reportFormats: this.options.reportFormats,
      cleanupShardFiles: this.options.cleanupShardFiles
    });

    this.shardingStrategy = new SmartStrategy();

    this.ensureDirectories();
  }

  private async autoAssignShard(): Promise<void> {
    try {
      const runner = new AutoShardRunner({
        projectRoot: process.cwd()
      });
      const shardId = await runner.runSingleShard();
      console.log(chalk.cyan(`Auto-assigned shard ${shardId}`));
    } catch (error) {
      console.warn('Could not auto-assign shard:', error);
    }
  }

  private ensureDirectories(): void {
    const dirs = [
      this.options.shardedCoverageDir!,
      this.options.finalCoverageDir!
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  private log(message: string, force: boolean = false): void {
    if (this.options.verbose || force) {
      console.log(chalk.gray(`[JestShardReporter] ${message}`));
    }
  }

  onRunStart(results: AggregatedResult, options: ReporterOnStartOptions): void {
    this.startTime = Date.now();
    console.log(chalk.bold.cyan(`\n🚀 Starting Test Shard ${this.shardInfo.index}/${this.shardInfo.total}\n`));
    this.log(`Running ${options.estimatedTime} estimated tests`);
  }

  onTestStart(test: Test): void {
    const relativePath = path.relative(process.cwd(), test.path);
    this.log(`Starting: ${relativePath}`);
    this.testDurations.set(test.path, Date.now());
  }

  onTestResult(test: Test, testResult: TestResult, aggregatedResult: AggregatedResult): void {
    const relativePath = path.relative(process.cwd(), test.path);
    const duration = Date.now() - (this.testDurations.get(test.path) || Date.now());

    this.shardingStrategy.updateTestDuration(test.path, duration);

    if (testResult.numFailingTests > 0) {
      console.log(chalk.red(`  ❌ FAIL`) + ` ${relativePath} (${(duration / 1000).toFixed(2)}s)`);

      if (testResult.failureMessage) {
        console.log(chalk.dim(testResult.failureMessage.split('\n').slice(0, 5).join('\n')));
      }
    } else if (testResult.skipped) {
      console.log(chalk.yellow(`  ⊘ SKIP`) + ` ${relativePath}`);
    } else {
      console.log(chalk.green(`  ✓ PASS`) + ` ${relativePath} (${(duration / 1000).toFixed(2)}s)`);
    }

    const stats = aggregatedResult.numTotalTests > 0 ?
      `(${aggregatedResult.numPassedTests}/${aggregatedResult.numTotalTests} passed)` : '';
    this.log(`Progress: ${stats}`);
  }

  async onRunComplete(contexts: Set<TestContext>, results: AggregatedResult): Promise<void> {
    const duration = (Date.now() - this.startTime) / 1000;

    console.log('\n' + chalk.bold('═'.repeat(60)));
    console.log(chalk.bold.cyan(`\nShard ${this.shardInfo.index}/${this.shardInfo.total} Summary:`));
    console.log(chalk.bold('─'.repeat(40)));

    const testsLine = results.numFailedTests > 0
      ? chalk.red(`${results.numFailedTests} failed`)
      : chalk.green('all passed');

    console.log(`  Tests:       ${chalk.green(`${results.numPassedTests} passed`)}, ${testsLine}, ${results.numTotalTests} total`);
    console.log(`  Test Suites: ${chalk.green(`${results.numPassedTestSuites} passed`)}, ${results.numFailedTestSuites} failed, ${results.numTotalTestSuites} total`);

    if (results.numPendingTests > 0) {
      console.log(`  Pending:     ${chalk.yellow(results.numPendingTests.toString())}`);
    }

    if (results.numTodoTests > 0) {
      console.log(`  Todo:        ${chalk.magenta(results.numTodoTests.toString())}`);
    }

    console.log(`  Time:        ${chalk.cyan(`${duration.toFixed(2)}s`)}`);

    if (this.globalConfig.collectCoverage) {
      await this.handleCoverage();
    }

    console.log(chalk.bold('═'.repeat(60)) + '\n');
  }

  private async handleCoverage(): Promise<void> {
    const coverageFile = path.join(this.options.coverageDirectory!, 'coverage-final.json');

    if (fs.existsSync(coverageFile)) {
      try {
        const coverageData = JSON.parse(fs.readFileSync(coverageFile, 'utf8'));
        await this.coverageCollector.collectShardCoverage(this.shardInfo.index, coverageData);
        console.log(chalk.green(`  ✓ Coverage saved for shard ${this.shardInfo.index}`));

        if (this.options.mergeCoverageOnComplete) {
          const isComplete = await this.coverageCollector.isAllShardsComplete(this.shardInfo.total);

          if (isComplete || process.env.JEST_MERGE_COVERAGE === 'true') {
            await this.mergeCoverageReports();
          } else {
            console.log(chalk.yellow(`  ⏳ Waiting for ${this.shardInfo.total - await this.coverageCollector.getShardCount()} more shard(s) to complete...`));
          }
        }
      } catch (error) {
        console.error(chalk.red(`  ✗ Error handling coverage:`), error);
      }
    } else {
      this.log(`No coverage file found for shard ${this.shardInfo.index}`, true);
    }
  }

  private async mergeCoverageReports(): Promise<void> {
    console.log('\n' + chalk.bold.blue('📊 Merging coverage from all shards...'));

    try {
      const coverageMap = await this.coverageCollector.mergeCoverage({
        reportFormats: this.options.reportFormats,
        cleanupShardFiles: this.options.cleanupShardFiles
      });

      const data = coverageMap.getCoverageSummary().toJSON();

      console.log(chalk.bold('\n📈 Combined Coverage Summary:'));
      console.log(chalk.bold('─'.repeat(40)));
      console.log(`  Statements: ${this.formatPercentage(data.statements.pct)}% (${data.statements.covered}/${data.statements.total})`);
      console.log(`  Branches:   ${this.formatPercentage(data.branches.pct)}% (${data.branches.covered}/${data.branches.total})`);
      console.log(`  Functions:  ${this.formatPercentage(data.functions.pct)}% (${data.functions.covered}/${data.functions.total})`);
      console.log(`  Lines:      ${this.formatPercentage(data.lines.pct)}% (${data.lines.covered}/${data.lines.total})`);

      console.log(chalk.green(`\n✅ Coverage reports generated in ${this.options.finalCoverageDir}/`));

      const shardCount = await this.coverageCollector.getShardCount();
      console.log(chalk.dim(`   Processed ${shardCount} shard(s)`));
    } catch (error) {
      console.error(chalk.red('✗ Error merging coverage:'), error);
    }
  }

  private formatPercentage(pct: number | string): string {
    const percentage = typeof pct === 'string' ? parseFloat(pct) : pct;
    if (isNaN(percentage)) return chalk.gray('N/A');
    if (percentage >= 80) return chalk.green(percentage.toFixed(2));
    if (percentage >= 50) return chalk.yellow(percentage.toFixed(2));
    return chalk.red(percentage.toFixed(2));
  }

  getLastError(): Error | undefined {
    return undefined;
  }
}