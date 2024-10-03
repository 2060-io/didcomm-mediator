module.exports = {
  preset: 'ts-jest',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testEnvironment: 'node',
  testPathIgnorePatterns: ['/node_modules/'],
  testMatch: ['**/?(*.)+(spec|test).+(ts|tsx|js)'],
  transform: {
    '^.+\\.(ts|tsx)?$': 'ts-jest',
  },
  collectCoverageFrom: ['src/**/*.{js,jsx,tsx,ts}'],
  coveragePathIgnorePatterns: ['/node_modules/', '/__tests__/'],
  testTimeout: 60000,
}
