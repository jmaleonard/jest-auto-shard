# jest-auto-shard

A powerful Jest reporter that enables **automatic test sharding** for large test suites with automatic coverage merging. No need to manually configure shard numbers or environment variables - it just works!

## Features

- **🚀 Automatic Sharding**: Auto-detects optimal shard count and distributes tests
- **🔄 Zero Configuration**: No environment variables or manual shard assignment needed
- **📊 Coverage Merging**: Automatically combines coverage reports from all shards
- **⚡ Parallel Execution**: Run multiple shards simultaneously for faster test runs
- **🎯 Smart Distribution**: Multiple strategies including history-based optimization
- **🎨 Beautiful Output**: Colored, formatted test results with progress tracking
- **📝 TypeScript Support**: Fully typed for better developer experience
- **🔧 CLI Tool**: Built-in command-line interface for easy usage

## Installation

```bash
npm install --save-dev jest-auto-shard
```

or

```bash
yarn add -D jest-auto-shard
```

## Quick Start

### Automatic Mode (Recommended) ✨

```bash
# Automatically detect optimal shards and run tests
npx jest-shard run

# That's it! Tests are automatically sharded and coverage is merged
# No environment variables or manual configuration needed!
```

### Manual Configuration

#### 1. Configure Jest

Add the reporter to your `jest.config.js`:

```javascript
module.exports = {
  reporters: [
    'default',
    ['jest-auto-shard', {
      shardedCoverageDir: 'coverage-shards',
      finalCoverageDir: 'coverage-final',
      reportFormats: ['html', 'text', 'lcov'],
      verbose: true
    }]
  ],
  collectCoverage: true
};
```

#### 2. Run Tests

```bash
# Option A: Use the CLI (automatic sharding)
npx jest-shard run --shards 4

# Option B: Run specific shard (for CI/CD)
npx jest-shard test --index 1 --total 4

# Option C: Custom coverage directories
npx jest-shard run --coverage-dir ./reports/coverage

# Option D: Traditional environment variables (still supported)
JEST_TOTAL_SHARDS=3 JEST_SHARD_INDEX=1 npx jest --shard=1/3
```

## CLI Commands

The `jest-shard` CLI provides powerful commands for managing your test sharding:

```bash
# Automatic sharding with optimal detection
jest-shard run

# Run with specific options
jest-shard run --shards 4 --parallel 2

# Analyze your test suite
jest-shard analyze

# Merge coverage manually
jest-shard merge

# Clean up artifacts
jest-shard clean

# Show examples
jest-shard examples
```

### Command Options

#### `jest-shard run`
Automatically runs all tests in shards with optimal detection:
- `--shards <n>`: Number of shards (auto-detects if not specified)
- `--parallel <n>`: Max parallel shards (defaults to CPU count)
- `--config <path>`: Path to Jest config file
- `--coverage-dir <dir>`: Directory for final merged coverage (default: coverage-final)
- `--shard-coverage-dir <dir>`: Directory for shard coverage files (default: coverage-shards)
- `--no-coverage`: Disable coverage collection
- `--verbose`: Enable verbose output

#### `jest-shard test`
Runs a specific shard (useful for CI/CD matrix builds):
- `--index <n>`: Shard index to run (required)
- `--total <n>`: Total number of shards (required)
- `--config <path>`: Path to Jest config file
- `--coverage-dir <dir>`: Directory for final merged coverage
- `--shard-coverage-dir <dir>`: Directory for shard coverage files

#### `jest-shard merge`
Manually merges coverage reports from all shards:
- `--source <dir>`: Source directory for shard coverage files (default: coverage-shards)
- `--output <dir>`: Output directory for merged coverage (default: coverage-final)
- `--formats <formats>`: Report formats, comma-separated (default: html,text,lcov,json)
- `--cleanup`: Clean up shard files after merging

#### `jest-shard analyze`
Analyzes your test suite and provides optimization recommendations:
- Shows test file count and sizes
- Recommends optimal shard count based on your system
- Provides distribution preview
- Identifies largest test files

#### `jest-shard clean`
Cleans up all shard artifacts and coverage directories

#### `jest-shard examples`
Shows comprehensive usage examples for different scenarios

## CI/CD Examples

### GitHub Actions (Automatic Mode)

```yaml
name: Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npx jest-shard run --shards 4
```

### GitHub Actions (Matrix Mode)

```yaml
name: Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        shard: [1, 2, 3, 4]
        total-shards: [4]

    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npx jest-shard test --index ${{ matrix.shard }} --total ${{ matrix.total-shards }}

      - name: Upload coverage artifacts
        uses: actions/upload-artifact@v3
        with:
          name: coverage-shard-${{ matrix.shard }}
          path: coverage-shards/

  merge-coverage:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Download all coverage artifacts
        uses: actions/download-artifact@v3
        with:
          path: coverage-shards/

      - name: Merge coverage reports
        run: |
          npm ci
          npx jest-shard-reporter merge

      - name: Upload final coverage
        uses: actions/upload-artifact@v3
        with:
          name: coverage-final
          path: coverage-final/
```

### GitLab CI

```yaml
stages:
  - test
  - coverage

variables:
  TOTAL_SHARDS: 4

.test-template:
  stage: test
  script:
    - npm ci
    - JEST_TOTAL_SHARDS=$TOTAL_SHARDS JEST_SHARD_INDEX=$SHARD_INDEX npm test -- --shard=$SHARD_INDEX/$TOTAL_SHARDS
  artifacts:
    paths:
      - coverage-shards/
    expire_in: 1 hour

test:shard:1:
  extends: .test-template
  variables:
    SHARD_INDEX: 1

test:shard:2:
  extends: .test-template
  variables:
    SHARD_INDEX: 2

test:shard:3:
  extends: .test-template
  variables:
    SHARD_INDEX: 3

test:shard:4:
  extends: .test-template
  variables:
    SHARD_INDEX: 4

merge-coverage:
  stage: coverage
  dependencies:
    - test:shard:1
    - test:shard:2
    - test:shard:3
    - test:shard:4
  script:
    - npm ci
    - npx jest-shard-reporter merge
  artifacts:
    reports:
      coverage_report:
        coverage_format: cobertura
        path: coverage-final/cobertura-coverage.xml
    paths:
      - coverage-final/
```

## Configuration Options

```typescript
interface ShardReporterOptions {
  // Number of total shards (default: from env or 1)
  totalShards?: number;

  // Current shard index (default: from env or 1)
  shardIndex?: number;

  // Directory for individual coverage files (default: 'coverage')
  coverageDirectory?: string;

  // Directory for shard coverage files (default: 'coverage-shards')
  shardedCoverageDir?: string;

  // Directory for merged coverage (default: 'coverage-final')
  finalCoverageDir?: string;

  // Enable verbose logging (default: false)
  verbose?: boolean;

  // Report formats to generate (default: ['html', 'text', 'lcov', 'json'])
  reportFormats?: string[];

  // Clean up shard files after merging (default: false)
  cleanupShardFiles?: boolean;

  // Automatically merge when all shards complete (default: true)
  mergeCoverageOnComplete?: boolean;
}
```

### Environment Variables

You can override coverage directories using environment variables:

- `JEST_FINAL_COVERAGE_DIR`: Override final coverage directory (default: 'coverage-final')
- `JEST_SHARD_COVERAGE_DIR`: Override shard coverage directory (default: 'coverage-shards')
- `JEST_COVERAGE_DIR`: Override base coverage directory (default: 'coverage')

Example:
```bash
# Use custom coverage directories
JEST_FINAL_COVERAGE_DIR=./reports/coverage jest-shard run

# Or via CLI flags
jest-shard run --coverage-dir ./reports/coverage --shard-coverage-dir ./temp/shards
```

## Package.json Scripts

Add these helpful scripts to your `package.json`:

```json
{
  "scripts": {
    "test": "jest",
    "test:auto": "jest-shard run",
    "test:analyze": "jest-shard analyze",
    "test:shard": "jest-shard run --shards 4",
    "test:custom-coverage": "jest-shard run --coverage-dir ./reports/coverage",
    "test:shard:ci": "jest-shard test --index $CI_NODE_INDEX --total $CI_NODE_TOTAL",
    "coverage:merge": "jest-shard merge",
    "coverage:merge:custom": "jest-shard merge --output ./reports/coverage",
    "coverage:clean": "jest-shard clean"
  }
}
```

## Programmatic API

### Automatic Sharding

```typescript
import { AutoShardRunner } from 'jest-auto-shard';

// Run tests with automatic sharding
const runner = new AutoShardRunner({
  totalShards: 4,        // Optional: auto-detects if not provided
  maxParallel: 2,        // Optional: max concurrent shards
  jestConfig: './jest.config.js'
});

await runner.run();
```

### Coverage Merging

```typescript
import { mergeCoverageReports } from 'jest-auto-shard';

// Merge coverage reports manually
await mergeCoverageReports({
  shardedCoverageDir: 'coverage-shards',
  finalCoverageDir: 'coverage-final',
  reportFormats: ['html', 'text', 'lcov'],
  cleanupShardFiles: true
});
```

## Sharding Strategies

The package includes several sharding strategies (used internally by Jest):

```typescript
import {
  RoundRobinStrategy,
  HashBasedStrategy,
  FileSizeStrategy,
  SmartStrategy
} from 'jest-auto-shard';

// Round-robin: Distributes tests evenly by index
const roundRobin = new RoundRobinStrategy();

// Hash-based: Consistent distribution using file path hash
const hashBased = new HashBasedStrategy();

// File-size: Balances shards by file size
const fileSize = new FileSizeStrategy();

// Smart: Uses test execution history for optimal distribution
const smart = new SmartStrategy('.test-history.json');
```

## How It Works

### Automatic Shard Detection

The reporter uses several techniques to automatically manage sharding:

1. **Optimal Shard Count**: Analyzes your test suite size and system resources
2. **Lock-Based Coordination**: Uses file locks to prevent shard conflicts
3. **Smart Distribution**: Balances tests across shards using historical data
4. **Automatic Recovery**: Handles failed shards and stale locks

### Shard Coordination

When running in automatic mode, the reporter:
- Creates a coordination directory in the system temp folder
- Uses atomic file operations to claim shards
- Tracks shard status (pending, running, completed, failed)
- Automatically cleans up after completion

## Advanced Usage

### Docker Compose Example

```yaml
version: '3.8'

services:
  test-shard-1:
    build: .
    environment:
      JEST_TOTAL_SHARDS: 3
      JEST_SHARD_INDEX: 1
    command: npm test -- --shard=1/3
    volumes:
      - ./coverage-shards:/app/coverage-shards

  test-shard-2:
    build: .
    environment:
      JEST_TOTAL_SHARDS: 3
      JEST_SHARD_INDEX: 2
    command: npm test -- --shard=2/3
    volumes:
      - ./coverage-shards:/app/coverage-shards

  test-shard-3:
    build: .
    environment:
      JEST_TOTAL_SHARDS: 3
      JEST_SHARD_INDEX: 3
    command: npm test -- --shard=3/3
    volumes:
      - ./coverage-shards:/app/coverage-shards
```

## Tips & Best Practices

1. **Automatic Mode**: Use `jest-shard run` for the simplest setup - it handles everything automatically.

2. **Optimal Shard Count**: Let the tool auto-detect, or use 2-4 shards for most projects.

3. **CI Parallelization**: Match shard count to available CI runners.

4. **Local Development**: Use `jest-shard analyze` to understand your test distribution.

5. **Coverage Thresholds**: Set coverage thresholds after merging, not per shard:
   ```javascript
   // jest.config.js
   module.exports = {
     coverageThreshold: {
       global: {
         branches: 80,
         functions: 80,
         lines: 80,
         statements: 80
       }
     }
   };
   ```

5. **Debugging**: Enable verbose mode to see detailed shard information:
   ```javascript
   ['jest-shard-reporter', { verbose: true }]
   ```

## Troubleshooting

### Coverage not merging automatically

Ensure all shards complete before merging. You can force merge with:
```bash
jest-shard merge
```

### Missing coverage data

Check that:
- `collectCoverage: true` is set in Jest config
- All shards are writing to the same coverage directory
- The directory has proper write permissions
- Custom coverage directories are set consistently across shards

### Custom coverage directories not working

Ensure you're using the same directory settings across all commands:
```bash
# Wrong - inconsistent directories
jest-shard run --coverage-dir ./reports
jest-shard merge --output ./coverage-final  # Different directory!

# Correct - consistent directories
jest-shard run --coverage-dir ./reports
jest-shard merge --output ./reports        # Same directory
```

### Tests not distributed evenly

The package uses multiple strategies for optimal distribution:
1. **Auto-detection** (recommended): Analyzes your test suite automatically
2. **Smart strategy**: Learns from execution history for better distribution
3. **Manual tuning**: Use `jest-shard analyze` to get recommendations

### Environment variables not taking effect

Environment variables have priority order:
1. CLI flags (highest)
2. Environment variables
3. Jest config options
4. Defaults (lowest)

Make sure you're not accidentally overriding with CLI flags.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

```bash
# Clone the repository
git clone https://github.com/jmaleonard/jest-auto-shard.git

# Install dependencies
npm install

# Run tests
npm test

# Build the package
npm run build
```

## License

MIT

## Support

For issues and feature requests, please use the [GitHub issues page](https://github.com/jmaleonard/jest-auto-shard/issues).

## Changelog

### 1.0.0
- Initial release
- Test sharding support
- Coverage merging
- Multiple sharding strategies
- TypeScript support
- Comprehensive documentation