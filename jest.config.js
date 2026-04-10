const path = require('path');

/** @type {import('jest').Config} */
module.exports = {
  testMatch: [
    '**/__tests__/**/*.test.ts',
    '**/__tests__/**/*.test.js',
  ],
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  moduleNameMapper: {
    '^@boardgamebuddy/game-pack-api$': '<rootDir>/api/index.ts',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: path.join(__dirname, 'tsconfig.test.json'),
    }],
  },
};
