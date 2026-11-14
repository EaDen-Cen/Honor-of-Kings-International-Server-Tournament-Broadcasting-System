import { writeHeroTemplatePack } from '../server/capture.js';

const { heroes, bytes, reused } = await writeHeroTemplatePack();
console.log(
  `Portrait templates: ${reused ? 'verified' : 'generated'} ${heroes} heroes, ${bytes} bytes.`,
);
