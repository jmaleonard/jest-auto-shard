import {
  RoundRobinStrategy,
  HashBasedStrategy,
  FileSizeStrategy,
  SmartStrategy
} from '../sharding-strategy';
import * as fs from 'fs';
import * as path from 'path';

jest.mock('fs');

describe('Sharding Strategies', () => {
  const testPaths = [
    '/tests/test1.spec.ts',
    '/tests/test2.spec.ts',
    '/tests/test3.spec.ts',
    '/tests/test4.spec.ts',
    '/tests/test5.spec.ts',
    '/tests/test6.spec.ts',
  ];

  describe('RoundRobinStrategy', () => {
    it('should distribute tests evenly across shards', () => {
      const strategy = new RoundRobinStrategy();

      const shard1 = strategy.distributeTests(testPaths, { index: 1, total: 3 });
      const shard2 = strategy.distributeTests(testPaths, { index: 2, total: 3 });
      const shard3 = strategy.distributeTests(testPaths, { index: 3, total: 3 });

      expect(shard1).toEqual(['/tests/test1.spec.ts', '/tests/test4.spec.ts']);
      expect(shard2).toEqual(['/tests/test2.spec.ts', '/tests/test5.spec.ts']);
      expect(shard3).toEqual(['/tests/test3.spec.ts', '/tests/test6.spec.ts']);
    });

    it('should handle single shard', () => {
      const strategy = new RoundRobinStrategy();
      const shard1 = strategy.distributeTests(testPaths, { index: 1, total: 1 });

      expect(shard1).toEqual(testPaths);
    });

    it('should return empty array for invalid shard index', () => {
      const strategy = new RoundRobinStrategy();
      const shard = strategy.distributeTests(testPaths, { index: 4, total: 3 });

      expect(shard).toEqual([]);
    });
  });

  describe('HashBasedStrategy', () => {
    it('should distribute tests consistently based on hash', () => {
      const strategy = new HashBasedStrategy();

      const shard1Run1 = strategy.distributeTests(testPaths, { index: 1, total: 2 });
      const shard1Run2 = strategy.distributeTests(testPaths, { index: 1, total: 2 });

      expect(shard1Run1).toEqual(shard1Run2);
    });

    it('should distribute all tests across shards', () => {
      const strategy = new HashBasedStrategy();

      const shard1 = strategy.distributeTests(testPaths, { index: 1, total: 2 });
      const shard2 = strategy.distributeTests(testPaths, { index: 2, total: 2 });

      const allTests = [...shard1, ...shard2].sort();
      expect(allTests).toEqual(testPaths.sort());
      expect(shard1.length + shard2.length).toBe(testPaths.length);
    });
  });

  describe('FileSizeStrategy', () => {
    beforeEach(() => {
      (fs.statSync as jest.Mock).mockImplementation((path: string) => {
        const sizes: { [key: string]: number } = {
          '/tests/test1.spec.ts': 1000,
          '/tests/test2.spec.ts': 2000,
          '/tests/test3.spec.ts': 1500,
          '/tests/test4.spec.ts': 500,
          '/tests/test5.spec.ts': 3000,
          '/tests/test6.spec.ts': 800,
        };
        return { size: sizes[path] || 0 };
      });
    });

    it('should distribute tests based on file size', () => {
      const strategy = new FileSizeStrategy();

      const shard1 = strategy.distributeTests(testPaths, { index: 1, total: 2 });
      const shard2 = strategy.distributeTests(testPaths, { index: 2, total: 2 });

      const allTests = [...shard1, ...shard2];
      expect(allTests.length).toBe(testPaths.length);

      const shard1Size = shard1.reduce((sum, path) => {
        return sum + (fs.statSync as jest.Mock)(path).size;
      }, 0);
      const shard2Size = shard2.reduce((sum, path) => {
        return sum + (fs.statSync as jest.Mock)(path).size;
      }, 0);

      expect(Math.abs(shard1Size - shard2Size)).toBeLessThan(2000);
    });

    it('should handle missing files gracefully', () => {
      (fs.statSync as jest.Mock).mockImplementation(() => {
        throw new Error('File not found');
      });

      const strategy = new FileSizeStrategy();
      const shard1 = strategy.distributeTests(testPaths, { index: 1, total: 2 });

      expect(shard1.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('SmartStrategy', () => {
    const historyFile = '.test-history.json';

    beforeEach(() => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      (fs.readFileSync as jest.Mock).mockReturnValue('{}');
      (fs.writeFileSync as jest.Mock).mockImplementation(() => {});
    });

    afterEach(() => {
      jest.clearAllMocks();
    });

    it('should distribute tests based on execution history', () => {
      const mockHistory: { [key: string]: number } = {
        '/tests/test1.spec.ts': 5000,
        '/tests/test2.spec.ts': 1000,
        '/tests/test3.spec.ts': 3000,
        '/tests/test4.spec.ts': 2000,
        '/tests/test5.spec.ts': 4000,
        '/tests/test6.spec.ts': 1500,
      };

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockHistory));

      const strategy = new SmartStrategy(historyFile);
      const shard1 = strategy.distributeTests(testPaths, { index: 1, total: 2 });
      const shard2 = strategy.distributeTests(testPaths, { index: 2, total: 2 });

      const allTests = [...shard1, ...shard2];
      expect(allTests.length).toBe(testPaths.length);

      const shard1Duration = shard1.reduce((sum, path) => sum + (mockHistory[path] || 0), 0);
      const shard2Duration = shard2.reduce((sum, path) => sum + (mockHistory[path] || 0), 0);

      expect(Math.abs(shard1Duration - shard2Duration)).toBeLessThan(3000);
    });

    it('should update test duration and save to history', () => {
      const strategy = new SmartStrategy(historyFile);
      strategy.updateTestDuration('/tests/test1.spec.ts', 5000);

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        historyFile,
        expect.stringContaining('test1.spec.ts')
      );
    });

    it('should handle missing history file', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const strategy = new SmartStrategy(historyFile);
      const shard1 = strategy.distributeTests(testPaths, { index: 1, total: 2 });

      expect(shard1.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle corrupted history file', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue('invalid json');

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const strategy = new SmartStrategy(historyFile);
      expect(consoleSpy).toHaveBeenCalledWith(
        'Could not load test history:',
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });
  });
});