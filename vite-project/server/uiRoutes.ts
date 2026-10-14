/** HTML shell paths served by the Node backend after Vite production build.
 * All overlay pages are routed inside BroadcastApp, not separate HTML bundles.
 * Keep API/static asset handling outside this predicate.
 */
const htmlRoutes=new Set([
  '/','/control','/caster',
  '/overlay/draft','/overlay/game-hud','/overlay/mvp',
  '/overlay/postgame-compare','/overlay/game-progress',
  '/tools/bp-simulator','/tools/bp-simulator-control',
]);
export const isBroadcastPageRoute=(path:string)=>htmlRoutes.has(path);
