export { JestShardReporter } from './reporter';
export { JestShardReporter as default } from './reporter';
export { CoverageCollector, IstanbulCoverageMerger } from './coverage-merger';
export {
  RoundRobinStrategy,
  HashBasedStrategy,
  FileSizeStrategy,
  SmartStrategy
} from './sharding-strategy';
export { AutoShardRunner, AutoShardCoordinator } from './auto-shard';
export type {
  ShardReporterOptions,
  ShardInfo,
  CoverageFile,
  MergeOptions,
  TestShardingStrategy,
  CoverageMerger
} from './types';

import { CoverageCollector } from './coverage-merger';

export async function mergeCoverageReports(options?: {
  shardedCoverageDir?: string;
  finalCoverageDir?: string;
  reportFormats?: string[];
  cleanupShardFiles?: boolean;
}): Promise<void> {
  const collector = new CoverageCollector(options);

  try {
    await collector.mergeCoverage({
      reportFormats: options?.reportFormats || ['html', 'text', 'lcov', 'json'],
      cleanupShardFiles: options?.cleanupShardFiles || false
    });
    console.log('✅ Coverage reports merged successfully');
  } catch (error) {
    console.error('❌ Error merging coverage reports:', error);
    process.exit(1);
  }
}