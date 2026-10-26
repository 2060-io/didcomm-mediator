module.exports = {
  preset: 'ts-jest/presets/default-esm',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testEnvironment: 'node',
  testPathIgnorePatterns: ['/node_modules/'],
  testMatch: ['**/?(*.)+(spec|test).+(ts|tsx|js)'],
  setupFiles: ['<rootDir>/test/jest.setup.ts'],
  transform: {
    '^.+\\.(ts|tsx)?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: 'tsconfig.json',
      },
    ],
  },
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    // webcrypto-core's ESM build is a .js file without "type": "module", which Jest can only load as CommonJS
    '^webcrypto-core$': require.resolve('webcrypto-core', { paths: [require.resolve('@credo-ts/core/package.json')] }),
  },
  transformIgnorePatterns: ['/node_modules/(?!@credo-ts|@2060.io|@openwallet-foundation)/'],
  collectCoverageFrom: ['src/**/*.{js,jsx,tsx,ts}'],
  coveragePathIgnorePatterns: ['/node_modules/', '/__tests__/'],
  testTimeout: 60000,
}
