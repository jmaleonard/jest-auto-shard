import type { Config } from '@jest/types';
import type { AggregatedResult, Test, TestResult } from '@jest/reporters';
import type { CoverageMap } from 'istanbul-lib-coverage';

export interface ShardReporterOptions {
  totalShards?: number;
  shardIndex?: number;
  coverageDirectory?: string;
  shardedCoverageDir?: string;
  finalCoverageDir?: string;
  verbose?: boolean;
  reportFormats?: string[];
  cleanupShardFiles?: boolean;
  mergeCoverageOnComplete?: boolean;
}

export interface ShardInfo {
  index: number;
  total: number;
}

export interface CoverageFile {
  path: string;
  coverage: any;
}

export interface MergeOptions {
  shardedCoverageDir?: string;
  finalCoverageDir?: string;
  reportFormats?: string[];
  verbose?: boolean;
  cleanupShardFiles?: boolean;
}

export interface TestShardingStrategy {
  distributeTests(testPaths: string[], shardInfo: ShardInfo): string[];
}

export interface CoverageMerger {
  merge(coverageFiles: CoverageFile[]): CoverageMap;
  generateReports(coverageMap: CoverageMap, outputDir: string, formats: string[]): void;
}