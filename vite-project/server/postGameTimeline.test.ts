import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGoldTimelineText,validGoldTimeline } from '../src/shared/postGameTimeline.js';
test('replay samples parse minutes, K and ten-thousands without guessing',()=>{
  const data=parseGoldTimelineText('time,blue,red\n02:00,3.5K,３．８ｋ\n05:30,1.1万,11000');
  assert.deepEqual(data,[{timeSeconds:120,blueGold:3500,redGold:3800},{timeSeconds:330,blueGold:11000,redGold:11000}]);
  assert.equal(validGoldTimeline(data),true);
});
test('replay points reject duplicates, malformed fields and fabricated time series',()=>{
  for(const source of ['02:00,3K,4K','02:00,3K,4K\n02:00,5K,6K','03:00,3K,4K\n02:00,4K,6K','02:00,2K,2K\n03:00,O.3K,5K','02:00,1K,2K\n200:00,2K,3K'])assert.throws(()=>parseGoldTimelineText(source));
});
