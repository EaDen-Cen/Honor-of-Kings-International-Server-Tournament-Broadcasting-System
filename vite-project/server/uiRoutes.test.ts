import test from 'node:test';
import assert from 'node:assert/strict';
import { isBroadcastPageRoute } from './uiRoutes.js';

test('production backend serves the same SPA entry point for all published post-game overlays',()=>{
  for(const path of ['/overlay/mvp','/overlay/postgame-compare','/overlay/game-progress','/overlay/draft','/overlay/game-hud','/control','/caster'])
    assert.equal(isBroadcastPageRoute(path),true,path);
});
test('unknown overlays, arbitrary paths and API never silently fall through to an HTML shell',()=>{
  for(const path of ['/overlay/never-existed','/api/heroes','/dist/main.js','/overlay/postgame-compare/../bad','/overlay/postgame-compare%2Fbad'])
    assert.equal(isBroadcastPageRoute(path),false,path);
});
