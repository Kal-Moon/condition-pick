import test from 'node:test';
import assert from 'node:assert/strict';
import { searchSite, fixtureSnapshot, quickTiming } from './fixtures/search-site.js';
test('parser reads actual sale-variant prices and IDs, omits advertisements and promotional prices',()=>{
  const f=searchSite();
  try {
    const page=f.api.readPage();
    assert.equal(page.page,1); assert.equal(page.hasNext,true);
    assert.deepEqual(Array.from(page.products,product=>product.id),['101','102']);
    assert.equal(page.products[0].displayedPrice,1000000);
    assert.equal(page.products[1].configuration,'SSD 1TB');
    assert.match(page.products[0].sourceUrl,/pcode=101/);
  } finally {f.dom.window.close();}
});
test('collector applies each frozen combination, waits through loading, scans all pages and emits completion only after last page',async()=>{
  const f=searchSite();const events=[];
  try {
    await f.api.run({groups:[{id:'A',snapshot:fixtureSnapshot('5')},{id:'B',snapshot:fixtureSnapshot('7')}],common:{budget:1100000,includeShipping:true}},
      async event=>events.push(structuredClone(event)),new AbortController().signal,f.document,quickTiming);
    const pages=events.filter(event=>event.kind==='page');
    assert.deepEqual(pages.map(event=>[event.groupId,event.page,event.hasNext]),[['A',1,true],['A',2,false],['B',1,false]]);
    assert.deepEqual(pages[1].products.map(product=>product.id),['103']);
    assert.equal(events.at(-1).kind,'group-complete');assert.equal(events.at(-1).groupId,'B');
    assert.equal(f.document.querySelector('#attr-cpu-5-0').getAttribute('aria-checked'),'false');
    assert.equal(f.document.querySelector('#attr-cpu-7-1').getAttribute('aria-checked'),'true');
  }finally{f.dom.window.close();}
});
test('stalled and repeated pages fail without a false completion, and cancellation stops before another page',async()=>{
  for(const mode of ['missingNext','repeats','cancel']){
    const f=searchSite();const events=[];const controller=new AbortController();
    try{
      if(mode!=='cancel')f[mode]();
      await assert.rejects(()=>f.api.run({groups:[{id:'A',snapshot:fixtureSnapshot('5')}],common:{budget:null,includeShipping:false}},async event=>{
        events.push(structuredClone(event));if(mode==='cancel'&&event.kind==='page')controller.abort();
      },controller.signal,f.document,{...quickTiming,timeoutMs:350}),/??|??|??/);
      assert.equal(events.filter(event=>event.kind==='page').length,1);
      assert.equal(events.some(event=>event.kind==='group-complete'),false);
    }finally{f.dom.window.close();}
  }
});
test('unrecognised lists are not empty success; explicit empty results can complete one page',()=>{
  const f=searchSite();
  try{
    f.document.getElementById('productListArea').innerHTML='<p>???? ??</p>';
    assert.throws(()=>f.api.readPage(),/??/);
    f.document.getElementById('productListArea').innerHTML='<p>?? ?? ???? ???? ??? ????.</p>';
    const page=f.api.readPage(); assert.equal(page.empty,true);assert.equal(page.products.length,0);assert.equal(page.hasNext,false);
  }finally{f.dom.window.close();}
});
test('a changed shipping switch alone cannot certify an unchanged stale product list',async()=>{
  const f=searchSite();const events=[];
  try{
    const old=f.document.getElementById('shipping');const replacement=old.cloneNode(true);old.replaceWith(replacement);
    replacement.addEventListener('click',()=>replacement.setAttribute('aria-checked','true'));
    await assert.rejects(()=>f.api.run({groups:[{id:'A',snapshot:fixtureSnapshot('5')}],common:{budget:null,includeShipping:true}},
      async event=>events.push(structuredClone(event)),new AbortController().signal,f.document,{...quickTiming,timeoutMs:300}),/?? ??/);
    assert.equal(events.some(event=>event.kind==='page'),false);
  }finally{f.dom.window.close();}
});
