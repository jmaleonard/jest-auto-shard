import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { CoverageMerger, CoverageFile, MergeOptions } from './types';
import { createCoverageMap, CoverageMap } from 'istanbul-lib-coverage';
import { createContext } from 'istanbul-lib-report';
import reports from 'istanbul-reports';

export class IstanbulCoverageMerger implements CoverageMerger {
  merge(coverageFiles: CoverageFile[]): CoverageMap {
    const coverageMap = createCoverageMap({});

    for (const file of coverageFiles) {
      try {
        coverageMap.merge(file.coverage);
      } catch (error) {
        console.warn(`Error merging coverage for ${file.path}:`, error);
      }
    }

    return coverageMap;
  }

  generateReports(coverageMap: CoverageMap, outputDir: string, formats: string[]): void {
    const context = createContext({
      dir: outputDir,
      defaultSummarizer: 'nested',
      coverageMap,
      watermarks: {
        statements: [50, 80],
        functions: [50, 80],
        branches: [50, 80],
        lines: [50, 80]
      }
    });

    for (const format of formats) {
      try {
        const report = reports.create(format as any, {
          projectRoot: process.cwd(),
          skipEmpty: false,
          skipFull: false
        });

        report.execute(context);
      } catch (error) {
        console.warn(`Error generating ${format} report:`, error);
      }
    }
  }
}

export class CoverageCollector {
  private shardedCoverageDir: string;
  private finalCoverageDir: string;
  private merger: CoverageMerger;

  constructor(options: MergeOptions = {}) {
    this.shardedCoverageDir = options.shardedCoverageDir || 'coverage-shards';
    this.finalCoverageDir = options.finalCoverageDir || 'coverage-final';
    this.merger = new IstanbulCoverageMerger();
  }

  async collectShardCoverage(shardIndex: number, coverageData: any): Promise<void> {
    this.ensureDirectory(this.shardedCoverageDir);

    const shardFile = path.join(this.shardedCoverageDir, `coverage-shard-${shardIndex}.json`);

    await fs.promises.writeFile(shardFile, JSON.stringify(coverageData, null, 2));
  }

  async mergeCoverage(options: MergeOptions = {}): Promise<CoverageMap> {
    const shardFiles = await glob(path.join(this.shardedCoverageDir, 'coverage-shard-*.json'));

    if (shardFiles.length === 0) {
      throw new Error('No shard coverage files found to merge');
    }

    const coverageFiles: CoverageFile[] = [];

    for (const file of shardFiles) {
      try {
        const coverage = JSON.parse(await fs.promises.readFile(file, 'utf8'));
        coverageFiles.push({ path: file, coverage });
      } catch (error) {
        console.warn(`Error reading ${file}:`, error);
      }
    }

    const mergedCoverage = this.merger.merge(coverageFiles);

    this.ensureDirectory(this.finalCoverageDir);

    const mergedFile = path.join(this.finalCoverageDir, 'coverage-final.json');
    await fs.promises.writeFile(
      mergedFile,
      JSON.stringify(mergedCoverage.toJSON(), null, 2)
    );

    if (options.reportFormats && options.reportFormats.length > 0) {
      this.merger.generateReports(
        mergedCoverage,
        this.finalCoverageDir,
        options.reportFormats
      );
    }

    if (options.cleanupShardFiles) {
      await this.cleanupShardFiles();
    }

    return mergedCoverage;
  }

  async cleanupShardFiles(): Promise<void> {
    const shardFiles = await glob(path.join(this.shardedCoverageDir, 'coverage-shard-*.json'));

    for (const file of shardFiles) {
      try {
        await fs.promises.unlink(file);
      } catch (error) {
        console.warn(`Error deleting ${file}:`, error);
      }
    }
  }

  private ensureDirectory(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  async getShardCount(): Promise<number> {
    const shardFiles = await glob(path.join(this.shardedCoverageDir, 'coverage-shard-*.json'));
    return shardFiles.length;
  }

  async isAllShardsComplete(expectedShards: number): Promise<boolean> {
    const count = await this.getShardCount();
    return count === expectedShards;
  }
}