import test from 'node:test';import assert from 'node:assert/strict';
import {locateBadgeLabel} from './playerLabelRegion.js';
test('badge fallback ignores text-free badges and other color patterns',()=>{
  const width=64,height=40,data=new Uint8Array(width*height*3);
  assert.equal(locateBadgeLabel(data,width,height),undefined);
  for(let y=5;y<=20;y++)for(let x=4;x<=19;x++){
    const i=(y*width+x)*3;data[i]=255;data[i+1]=y<=12?0:255;data[i+2]=y<=12?0:255;
  }
  assert.equal(locateBadgeLabel(data,width,height),undefined,'badge without adjacent text is not an ID crop');
  for(let i=0;i<data.length;i+=3){const red=data[i];data[i]=data[i+2];data[i+2]=red;}
  assert.equal(locateBadgeLabel(data,width,height),undefined,'unrecognized badge colors retain the normal OCR path');
});

test('badge fallback selects the complete neighboring label and excludes remote bright artwork',()=>{
  for(const after of [true,false]){
    const width=180,height=40,data=new Uint8Array(width*height*3);
    for(let i=0;i<data.length;i+=3){data[i]=100;data[i+1]=60;data[i+2]=30;}
    const flagLeft=after?4:148,flagRight=flagLeft+23;
    for(let y=6;y<=29;y++)for(let x=flagLeft;x<=flagRight;x++){
      const i=(y*width+x)*3;data[i]=255;data[i+1]=y<=17?0:255;data[i+2]=y<=17?0:255;
    }
    const textLeft=after?36:76,textRight=textLeft+65;
    for(let y=12;y<=24;y++)for(let x=textLeft;x<=textRight;x++)if((x-textLeft)%10<6){
      const i=(y*width+x)*3;data[i]=220;data[i+1]=220;data[i+2]=220;
    }
    const artLeft=after?120:10;
    for(let y=8;y<=13;y++)for(let x=artLeft;x<artLeft+20;x++){
      const i=(y*width+x)*3;data[i]=255;data[i+1]=255;data[i+2]=255;
    }
    const region=locateBadgeLabel(data,width,height)!;
    assert.ok(region,'verified badge with neighboring text must be located');
    assert.ok(region.left<=textLeft&&region.left+region.width>textRight);
    assert.ok(region.top<=12&&region.top+region.height>24);
    if(after){assert.ok(region.left>flagRight);assert.ok(region.left+region.width<artLeft);}
    else{assert.ok(region.left+region.width<=flagLeft);assert.ok(region.left>artLeft+20);}
  }
});

