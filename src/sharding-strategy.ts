import { TestShardingStrategy, ShardInfo } from './types';
import * as crypto from 'crypto';
import * as fs from 'fs';

export class RoundRobinStrategy implements TestShardingStrategy {
  distributeTests(testPaths: string[], shardInfo: ShardInfo): string[] {
    return testPaths.filter((_, index) => index % shardInfo.total === shardInfo.index - 1);
  }
}

export class HashBasedStrategy implements TestShardingStrategy {
  distributeTests(testPaths: string[], shardInfo: ShardInfo): string[] {
    return testPaths.filter(path => {
      const hash = crypto.createHash('md5').update(path).digest('hex');
      const hashNum = parseInt(hash.substring(0, 8), 16);
      return (hashNum % shardInfo.total) === (shardInfo.index - 1);
    });
  }
}

export class FileSizeStrategy implements TestShardingStrategy {
  distributeTests(testPaths: string[], shardInfo: ShardInfo): string[] {
    const filesWithSizes = testPaths.map(path => ({
      path,
      size: this.getFileSize(path)
    }));

    filesWithSizes.sort((a, b) => b.size - a.size);

    const shards: { paths: string[]; totalSize: number }[] = Array.from(
      { length: shardInfo.total },
      () => ({ paths: [], totalSize: 0 })
    );

    for (const file of filesWithSizes) {
      const minShard = shards.reduce((min, shard, index) =>
        shard.totalSize < shards[min].totalSize ? index : min, 0
      );
      shards[minShard].paths.push(file.path);
      shards[minShard].totalSize += file.size;
    }

    return shards[shardInfo.index - 1].paths;
  }

  private getFileSize(path: string): number {
    try {
      return fs.statSync(path).size;
    } catch {
      return 0;
    }
  }
}

export class SmartStrategy implements TestShardingStrategy {
  private historyFile = '.jest-shard-history.json';
  private testHistory: Map<string, number> = new Map();

  constructor(historyFile?: string) {
    if (historyFile) {
      this.historyFile = historyFile;
    }
    this.loadHistory();
  }

  distributeTests(testPaths: string[], shardInfo: ShardInfo): string[] {
    const testsWithDuration = testPaths.map(path => ({
      path,
      duration: this.testHistory.get(path) || 1000
    }));

    testsWithDuration.sort((a, b) => b.duration - a.duration);

    const shards: { paths: string[]; totalDuration: number }[] = Array.from(
      { length: shardInfo.total },
      () => ({ paths: [], totalDuration: 0 })
    );

    for (const test of testsWithDuration) {
      const minShard = shards.reduce((min, shard, index) =>
        shard.totalDuration < shards[min].totalDuration ? index : min, 0
      );
      shards[minShard].paths.push(test.path);
      shards[minShard].totalDuration += test.duration;
    }

    return shards[shardInfo.index - 1].paths;
  }

  updateTestDuration(testPath: string, duration: number): void {
    this.testHistory.set(testPath, duration);
    this.saveHistory();
  }

  private loadHistory(): void {
    try {
      if (fs.existsSync(this.historyFile)) {
        const data = JSON.parse(fs.readFileSync(this.historyFile, 'utf8'));
        this.testHistory = new Map(Object.entries(data));
      }
    } catch (error) {
      console.warn('Could not load test history:', error);
    }
  }

  private saveHistory(): void {
    try {
      const data = Object.fromEntries(this.testHistory);
      fs.writeFileSync(this.historyFile, JSON.stringify(data, null, 2));
    } catch (error) {
      console.warn('Could not save test history:', error);
    }
  }
}