import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import * as model from '../extension/model.js';
import { searchIsStale } from '../extension/search-model.js';
import { searchSite, fixtureSnapshot, readExtension, sourceUrl, quickTiming } from './fixtures/search-site.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(check) {
  const deadline=Date.now()+10000;
  while(!check()){if(Date.now()>deadline)throw new Error('Search integration timed out');await new Promise(resolve=>setTimeout(resolve,10));}
}
test('search UI, persistent worker orchestration and actual site adapters collect and union two groups without changing source tab',async()=>{
  let state=model.reduceState(model.initialState(),{type:'capture',name:'A',snapshot:fixtureSnapshot('5')});
  state=model.reduceState(state,{type:'capture',name:'B',snapshot:fixtureSnapshot('7')});
  state=model.reduceState(state,{type:'budget',value:1100000});
  const local={[model.STORAGE_KEY]:state},session={},listeners=[],handlers=[],workers=new Map();
  const tabs=new Map([[1,{id:1,url:sourceUrl,active:true}]]);
  const source=searchSite();const original=source.document.body.innerHTML;
  const storage=(values,area)=>({async get(key){return{[key]:structuredClone(values[key])};},async set(update){
    const changes={};for(const[key,value]of Object.entries(update)){
      changes[key]={oldValue:structuredClone(values[key]),newValue:structuredClone(value)};values[key]=structuredClone(value);
    }listeners.forEach(fn=>fn(changes,area));
  }});
  function call(message,sender){return new Promise((resolve,reject)=>{
    if(!handlers[0](message,sender,resolve))reject(new Error('No background receiver'));
  });}
  let nextTab=2;
  globalThis.chrome={
    runtime:{id:'search-test',getURL:path=>'chrome-extension://search-test/'+path,onMessage:{addListener:fn=>handlers.push(fn)},onInstalled:{addListener(){}}},
    storage:{local:storage(local,'local'),session:storage(session,'session')},
    tabs:{
      async get(id){if(!tabs.has(id))throw new Error('Tab closed');return tabs.get(id);},
      async query(){return[tabs.get(1)];},async update(id,change){Object.assign(tabs.get(id),change);return tabs.get(id);},
      async remove(id){tabs.delete(id);workers.get(id)?.dom.window.close();workers.delete(id);},
      async create(change){
        const tab={id:nextTab++,...change};tabs.set(tab.id,tab);
        if(change.url.includes('condition-pick-worker=')){
          const f=searchSite(change.url);workers.set(tab.id,f);
          const collector=f.api;
          f.dom.window.ConditionPickCollector={run:(plan,emit,signal)=>collector.run(plan,emit,signal,f.document,quickTiming)};
          f.dom.window.chrome={runtime:{id:'search-test',onMessage:{addListener:fn=>{f.listener=fn;}},
            sendMessage:message=>call(message,{id:'search-test',url:tab.url,tab})}};
          // Loading a real worker content script exercises its handshake, progress messages and finish path.
          f.dom.window.eval(readExtension('content.js'));
        }
        return tab;
      },
      async sendMessage(id,message){
        const f=workers.get(id);if(!f)throw new Error('Missing worker');
        return new Promise(resolve=>f.listener(message,{id:'search-test'},resolve));
      }
    }
  };
  const view=new JSDOM(readExtension('view.html'),{url:'https://extension.test/view.html?surface=panel&source=1',runScripts:'outside-only'});
  try{
    await import('../extension/background.js?search-integration');
    Object.assign(view.window,{STORAGE_KEY:model.STORAGE_KEY,readState:model.readState,safeProductUrl:model.safeProductUrl,searchIsStale});
    view.window.chrome={runtime:{sendMessage:message=>call(message,{id:'search-test',url:'chrome-extension://search-test/view.html'})},
      storage:{onChanged:{addListener:fn=>listeners.push(fn)}}};
    view.window.eval(readExtension('view.js').replace(/^import[^;]+;/gm,''));
    await tick();view.window.document.getElementById('search').click();
    await until(()=>['complete','partial','stopped'].includes(local[model.STORAGE_KEY].search?.phase));
    const result=local[model.STORAGE_KEY];
    assert.equal(result.search.phase,'complete',result.search.errors.join(' / '));
    assert.equal(result.search.searchComplete,true);
    assert.deepEqual(result.search.progress.map(group=>group.pages),[2,1]);
    assert.deepEqual(result.results.map(product=>product.id),['101','103','104']);
    assert.equal(result.results[0].matchedGroups.length,2);
    assert.deepEqual(result.results[0].observations.map(item=>item.price),[1000000,980000]);
    await until(()=>workers.size===0);
    assert.equal(tabs.has(1),true);assert.equal(source.document.body.innerHTML,original);
    assert.equal(tabs.get(1).active,true);
    assert.equal(view.window.document.querySelectorAll('#results .product').length,3);
    assert.match(view.window.document.getElementById('search-status').textContent,/?? ??/);
    view.window.document.getElementById('result-group').value=result.groups[0].id;
    view.window.document.getElementById('result-group').dispatchEvent(new view.window.Event('change'));
    assert.equal(view.window.document.querySelectorAll('#results .product').length,2);
  }finally{view.window.close();source.dom.window.close();workers.forEach(f=>f.dom.window.close());}
});
