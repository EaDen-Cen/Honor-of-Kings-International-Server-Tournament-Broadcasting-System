import { test,expect } from './fixtures';

test('local OBS director lists audio sources and sends deliberate fade commands',async({page})=>{
  let currentVolume=0.65;
  const commands:Array<{inputName:string;targetVolume:number;durationMs:number}>=[];
  await page.route('**/api/v1/obs/status',route=>route.fulfill({json:{
    configured:true,connected:true,scenes:['BP','Game'],programScene:'BP',recording:true,
  }}));
  await page.route('**/api/v1/obs/audio',async route=>{
    if(route.request().method()==='GET'){
      await route.fulfill({json:{inputs:[{name:'Music',volume:currentVolume}]}});return;
    }
    const command=route.request().postDataJSON() as {inputName:string;targetVolume:number;durationMs:number};
    commands.push(command);currentVolume=command.targetVolume;
    await route.fulfill({json:{inputName:command.inputName,volume:currentVolume}});
  });
  await page.goto('/control#token=e2e-control');
  const director=page.getByTestId('obs-director');
  await director.locator('summary').click();
  await expect(director).toContainText('已连接');
  const mixer=page.getByTestId('obs-audio-mixer');
  await expect(mixer.getByRole('combobox',{name:'OBS audio input'})).toHaveValue('Music');
  await expect(mixer.getByRole('slider',{name:'OBS target volume'})).toHaveValue('65');
  await mixer.getByRole('button',{name:'淡出至静音'}).click();
  await expect.poll(()=>commands.length).toBe(1);
  expect(commands[0]).toEqual({inputName:'Music',targetVolume:0,durationMs:3000});
  await expect(mixer).toContainText('当前音量：0%');
  await mixer.getByRole('button',{name:'淡入至目标音量'}).click();
  await expect.poll(()=>commands.length).toBe(2);
  expect(commands[1]).toEqual({inputName:'Music',targetVolume:0.65,durationMs:3000});
  await expect(mixer).toContainText('当前音量：65%');
});
