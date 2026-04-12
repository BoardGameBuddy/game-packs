import * as path from 'path';
import { replayRecordings } from '@boardgamebuddy/game-pack-api/replay-runner';

import * as scorer from '../scorer';
const recordingsDir = path.join(__dirname, 'recordings');

replayRecordings(recordingsDir, scorer);
