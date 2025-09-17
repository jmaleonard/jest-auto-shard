module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.ts', '**/*.test.ts', '**/*.spec.ts'],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['json', 'text', 'html'],
  reporters: [
    'default',
    [
      './dist/index.js',
      {
        verbose: true,
        shardedCoverageDir: 'coverage-shards',
        finalCoverageDir: 'coverage-final',
        reportFormats: ['html', 'text', 'lcov', 'json'],
        mergeCoverageOnComplete: true,
        cleanupShardFiles: false
      }
    ]
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.json'
    }]
  }
};