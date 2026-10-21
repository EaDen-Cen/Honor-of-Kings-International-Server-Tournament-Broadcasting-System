import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { aiPublicConfig, recognizeAiWithFallback, setAiConfig } from './aiRecognition.js';
const local=()=>Promise.resolve({preview:'ok',candidates:[{heroId:7,confidence:0.4}]});
afterEach(()=>setAiConfig({enabled:false,vendor:'openai',model:'',endpoint:'',apiKey:''}));
test('AI is opt-in and never exposes secret in configuration',()=>{
  const config=setAiConfig({enabled:true,vendor:'openai',model:'gpt-4o',endpoint:'',apiKey:'secret-value'});
  assert.equal(config.configured,true);
  assert.equal(JSON.stringify(config).includes('secret-value'),false);
  assert.equal(aiPublicConfig().enabled,true);
});
test('disallow insecure/private and cross-vendor endpoint',()=>{
  for(const endpoint of ['http://example.com/v1/chat/completions','https://127.0.0.1/v1/chat/completions','https://evil.example/v1/chat/completions']){
    assert.throws(()=>setAiConfig({enabled:true,vendor:'openai',model:'vision',endpoint,apiKey:'key'}));
  }
});
test('local recognition remains usable with AI disabled',async()=>{
  const result=await recognizeAiWithFallback('not even an image',[7],local);
  assert.equal(result.candidates[0].heroId,7);
});
test('missing vision model or list does not change recognition output',async()=>{
  setAiConfig({enabled:true,vendor:'openai',model:'',endpoint:'',apiKey:'key'});
  const result=await recognizeAiWithFallback('bad image',[7],local);
  assert.equal(result.candidates[0].heroId,7);
});
test('all provider selections accept their own default API endpoint',()=>{
  for(const vendor of ['openai','anthropic','gemini','deepseek','qwen','doubao','glm','kimi','baidu'] as const){
    const config=setAiConfig({enabled:false,vendor,model:'vision-enabled-model',endpoint:'',apiKey:'test-key'});
    assert.equal(config.vendor,vendor);
    assert.equal(config.configured,true);
  }
});
