#!/usr/bin/env node

import { Command } from 'commander';
import { AutoShardRunner, AutoShardCoordinator } from './auto-shard';
import { mergeCoverageReports } from './index';
import * as chalk from 'chalk';
import * as os from 'os';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const program = new Command();

program
  .name('jest-shard')
  .description('Automatically shard and run Jest tests with coverage merging')
  .version('1.0.0');

program
  .command('run')
  .description('Automatically run tests in shards')
  .option('-s, --shards <number>', 'Number of shards (auto-detects if not specified)')
  .option('-p, --parallel <number>', 'Max parallel shards (defaults to CPU count)')
  .option('-c, --config <path>', 'Path to Jest config file')
  .option('--coverage-dir <dir>', 'Directory for final merged coverage (default: coverage-final)')
  .option('--shard-coverage-dir <dir>', 'Directory for shard coverage files (default: coverage-shards)')
  .option('--no-coverage', 'Disable coverage collection')
  .option('--verbose', 'Enable verbose output')
  .action(async (options) => {
    console.log(chalk.bold.cyan('\n🚀 Jest Shard Reporter - Auto Runner\n'));

    const totalShards = options.shards ? parseInt(options.shards) : undefined;
    const maxParallel = options.parallel ? parseInt(options.parallel) : os.cpus().length;

    // Validate inputs
    if (totalShards && (isNaN(totalShards) || totalShards < 1)) {
      console.error(chalk.red('Error: Invalid shard count'));
      process.exit(1);
    }

    if (maxParallel && (isNaN(maxParallel) || maxParallel < 1)) {
      console.error(chalk.red('Error: Invalid parallel count'));
      process.exit(1);
    }

    // Set environment variables if custom directories are provided
    if (options.coverageDir) {
      process.env.JEST_FINAL_COVERAGE_DIR = options.coverageDir;
    }
    if (options.shardCoverageDir) {
      process.env.JEST_SHARD_COVERAGE_DIR = options.shardCoverageDir;
    }

    try {
      const runner = new AutoShardRunner({
        totalShards,
        maxParallel,
        jestConfig: options.config,
        projectRoot: process.cwd()
      });

      await runner.run();
      process.exit(0);
    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

program
  .command('merge')
  .description('Merge coverage reports from all shards')
  .option('-s, --source <dir>', 'Source directory for shard coverage files', 'coverage-shards')
  .option('-o, --output <dir>', 'Output directory for merged coverage', 'coverage-final')
  .option('-f, --formats <formats>', 'Report formats (comma-separated)', 'html,text,lcov,json')
  .option('--cleanup', 'Clean up shard files after merging')
  .action(async (options) => {
    console.log(chalk.bold.blue('\n📊 Merging Coverage Reports\n'));

    const formats = options.formats.split(',').map((f: string) => f.trim());

    try {
      await mergeCoverageReports({
        shardedCoverageDir: options.source,
        finalCoverageDir: options.output,
        reportFormats: formats,
        cleanupShardFiles: options.cleanup
      });

      console.log(chalk.green('✅ Coverage merged successfully!'));
      console.log(chalk.dim(`Output: ${options.output}/`));
    } catch (error) {
      console.error(chalk.red('Error merging coverage:'), error);
      process.exit(1);
    }
  });

program
  .command('test')
  .description('Run a single test shard (for CI/CD)')
  .option('-i, --index <number>', 'Shard index to run')
  .option('-t, --total <number>', 'Total number of shards')
  .option('-c, --config <path>', 'Path to Jest config file')
  .option('--coverage-dir <dir>', 'Directory for final merged coverage (default: coverage-final)')
  .option('--shard-coverage-dir <dir>', 'Directory for shard coverage files (default: coverage-shards)')
  .action((options) => {
    const shardIndex = parseInt(options.index);
    const totalShards = parseInt(options.total);

    if (!shardIndex || !totalShards) {
      console.error(chalk.red('Error: Both --index and --total are required'));
      process.exit(1);
    }

    if (shardIndex < 1 || shardIndex > totalShards) {
      console.error(chalk.red('Error: Invalid shard index'));
      process.exit(1);
    }

    console.log(chalk.cyan(`Running shard ${shardIndex}/${totalShards}`));

    // Set environment variables
    process.env.JEST_SHARD_INDEX = shardIndex.toString();
    process.env.JEST_TOTAL_SHARDS = totalShards.toString();

    // Set custom coverage directories if provided
    if (options.coverageDir) {
      process.env.JEST_FINAL_COVERAGE_DIR = options.coverageDir;
    }
    if (options.shardCoverageDir) {
      process.env.JEST_SHARD_COVERAGE_DIR = options.shardCoverageDir;
    }

    // Run Jest
    const args = ['jest', `--shard=${shardIndex}/${totalShards}`];
    if (options.config) {
      args.push('--config', options.config);
    }

    try {
      execSync(`npx ${args.join(' ')}`, {
        stdio: 'inherit'
      });
    } catch (error: any) {
      process.exit(error.status || 1);
    }
  });

program
  .command('analyze')
  .description('Analyze test distribution and provide recommendations')
  .option('-c, --config <path>', 'Path to Jest config file')
  .action((options) => {
    console.log(chalk.bold.cyan('\n📊 Analyzing Test Distribution\n'));

    try {
      // Get test files
      const args = ['jest', '--listTests'];
      if (options.config) {
        args.push('--config', options.config);
      }

      const output = execSync(`npx ${args.join(' ')}`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore']
      });

      const testFiles = output.split('\n').filter(line => line.trim());
      const cpuCount = os.cpus().length;

      console.log(chalk.bold('Test Suite Analysis:'));
      console.log(`  Total test files: ${chalk.green(testFiles.length)}`);
      console.log(`  Available CPUs: ${chalk.green(cpuCount)}`);

      // Analyze file sizes
      let totalSize = 0;
      const fileSizes: { path: string; size: number }[] = [];

      for (const file of testFiles) {
        try {
          const stats = fs.statSync(file);
          totalSize += stats.size;
          fileSizes.push({ path: file, size: stats.size });
        } catch {
          // Ignore files we can't stat
        }
      }

      fileSizes.sort((a, b) => b.size - a.size);

      console.log(`  Total test size: ${chalk.green((totalSize / 1024 / 1024).toFixed(2) + ' MB')}`);
      console.log(`  Avg file size: ${chalk.green((totalSize / fileSizes.length / 1024).toFixed(2) + ' KB')}`);

      // Recommendations
      console.log('\n' + chalk.bold('Recommendations:'));

      const recommendedShards = Math.min(
        cpuCount,
        Math.max(1, Math.ceil(testFiles.length / 20))
      );

      console.log(`  Recommended shards: ${chalk.yellow(recommendedShards)}`);

      if (testFiles.length < 10) {
        console.log(chalk.dim('  - Small test suite, sharding may not provide significant benefits'));
      } else if (testFiles.length < 50) {
        console.log(chalk.dim('  - Medium test suite, use 2-4 shards for best results'));
      } else {
        console.log(chalk.dim(`  - Large test suite, use ${recommendedShards} shards for optimal performance`));
      }

      // Show largest files
      if (fileSizes.length > 0) {
        console.log('\n' + chalk.bold('Largest test files:'));
        for (let i = 0; i < Math.min(5, fileSizes.length); i++) {
          const file = fileSizes[i];
          const relativePath = path.relative(process.cwd(), file.path);
          console.log(`  ${i + 1}. ${relativePath} (${(file.size / 1024).toFixed(1)} KB)`);
        }
      }

      // Distribution preview
      console.log('\n' + chalk.bold(`Distribution with ${recommendedShards} shards:`));

      const testsPerShard = Math.ceil(testFiles.length / recommendedShards);
      for (let i = 1; i <= recommendedShards; i++) {
        const start = (i - 1) * testsPerShard;
        const end = Math.min(i * testsPerShard, testFiles.length);
        const count = end - start;

        console.log(`  Shard ${i}: ${chalk.green(count + ' tests')}`);
      }

    } catch (error) {
      console.error(chalk.red('Error analyzing tests:'), error);
      process.exit(1);
    }
  });

program
  .command('clean')
  .description('Clean up shard artifacts and coverage directories')
  .action(() => {
    console.log(chalk.cyan('Cleaning up shard artifacts...'));

    const dirsToClean = [
      'coverage-shards',
      'coverage-final',
      '.jest-shard-locks'
    ];

    for (const dir of dirsToClean) {
      if (fs.existsSync(dir)) {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
          console.log(chalk.green(`  ✓ Removed ${dir}`));
        } catch (error) {
          console.warn(chalk.yellow(`  ⚠ Could not remove ${dir}:`, error));
        }
      }
    }

    // Clean up temp directory locks
    const tmpDir = os.tmpdir();
    const projectHash = require('crypto')
      .createHash('md5')
      .update(process.cwd())
      .digest('hex')
      .substring(0, 8);

    const lockDir = path.join(tmpDir, `jest-shard-${projectHash}`);
    if (fs.existsSync(lockDir)) {
      try {
        fs.rmSync(lockDir, { recursive: true, force: true });
        console.log(chalk.green('  ✓ Removed temporary lock files'));
      } catch (error) {
        console.warn(chalk.yellow('  ⚠ Could not remove lock files:', error));
      }
    }

    console.log(chalk.green('\n✅ Cleanup complete!'));
  });

// Show examples command
program
  .command('examples')
  .description('Show usage examples')
  .action(() => {
    console.log(chalk.bold.cyan('\n📚 Jest Auto-Shard Examples\n'));

    console.log(chalk.bold('Basic Usage:'));
    console.log(chalk.gray('  # Auto-detect and run all shards'));
    console.log('  $ jest-shard run\n');

    console.log(chalk.gray('  # Run with specific shard count'));
    console.log('  $ jest-shard run --shards 4\n');

    console.log(chalk.gray('  # Limit parallel execution'));
    console.log('  $ jest-shard run --shards 8 --parallel 2\n');

    console.log(chalk.bold('CI/CD Usage:'));
    console.log(chalk.gray('  # GitHub Actions matrix'));
    console.log('  $ jest-shard test --index ${{ matrix.shard }} --total ${{ matrix.total }}\n');

    console.log(chalk.gray('  # GitLab CI parallel'));
    console.log('  $ jest-shard test --index $CI_NODE_INDEX --total $CI_NODE_TOTAL\n');

    console.log(chalk.bold('Coverage Management:'));
    console.log(chalk.gray('  # Merge coverage after tests'));
    console.log('  $ jest-shard merge\n');

    console.log(chalk.gray('  # Custom directories'));
    console.log('  $ jest-shard merge --source my-coverage --output final-coverage\n');

    console.log(chalk.bold('Analysis:'));
    console.log(chalk.gray('  # Get recommendations'));
    console.log('  $ jest-shard analyze\n');

    console.log(chalk.gray('  # Clean up artifacts'));
    console.log('  $ jest-shard clean\n');

    console.log(chalk.bold('Jest Config:'));
    console.log(chalk.gray(`
  // jest.config.js
  module.exports = {
    reporters: [
      'default',
      ['jest-shard-reporter', {
        verbose: true,
        mergeCoverageOnComplete: true
      }]
    ]
  };
    `));
  });

program.parse(process.argv);