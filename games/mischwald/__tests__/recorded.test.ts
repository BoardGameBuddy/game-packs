import * as path from 'path';
import { replayRecordings } from '@boardgamebuddy/game-pack-api/replay-runner';

const scorer = require('../scorer');
const recordingsDir = path.join(__dirname, 'recordings');

replayRecordings(recordingsDir, scorer);
