import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
export const sourceUrl = 'https://prod.danawa.com/list/?cate=112758';
export const readExtension = name => readFileSync(new URL('../../extension/' + name, import.meta.url), 'utf8');
export const fixtureSnapshot = cpu => ({ schema:1,site:'danawa',category:'112758',sourceUrl,
  capturedAt:'2026-11-10T12:00:00.000Z',options:[{key:'attr-cpu-'+cpu,group:'CPU ??',label:'??i'+cpu}],
  price:{min:null,max:null},includeShipping:true });
export function searchSite(url = sourceUrl) {
  const dom = new JSDOM('<!doctype html><html><body><div id="filters"><h2>????</h2>' +
    '<div><div><div>CPU ??</div><div>' +
    '<div><button id="attr-cpu-5-0" role="checkbox" aria-checked="true"></button><label for="attr-cpu-5-0">??i5</label></div>' +
    '<div><button id="attr-cpu-7-1" role="checkbox" aria-checked="false"></button><label for="attr-cpu-7-1">??i7</label></div>' +
    '</div></div></div><div><div>???</div><div><input aria-label="?? ??"><input aria-label="?? ??"><button id="price-search">??</button></div></div></div>' +
    '<section id="productListArea"></section></body></html>',{url,runScripts:'outside-only'});
  const document=dom.window.document;
  let page=1, cpu='5', timer, stuck=false, repeats=false, missingNext=false;
  const data={
    '5': [[['101','SSD 512GB',1000000],['102','SSD 1TB',1200000]],[['103','SSD 512GB',1050000]]],
    '7': [[['101','SSD 512GB',980000],['104','SSD 1TB',1000000]]]
  };
  function render() {
    const area=document.getElementById('productListArea');
    const rows=data[cpu][repeats?0:page-1] || [];
    area.innerHTML='<label>?????<button id="shipping" role="switch" aria-checked="'+includeShipping+'"></button></label>'+
      '<div data-testid="BizAdProductItem" aria-label="??"><a href="https://prod.danawa.com/info/?pcode=999">??</a></div>'+
      '<div data-testid="ProductListView" role="list">'+rows.map(([id,config,price])=>
        '<div data-testid="ProductListItem" role="listitem"><div data-testid="ProductListTitle"><a href="https://prod.danawa.com/info/?pcode='+id+'">?? ?? i'+cpu+'</a></div>'+
        '<div data-testid="ProductListSpecs">??i'+cpu+' / 32GB / ???11 / 512GB</div><div data-testid="ProductListBenefits">?? ??? 1?</div>'+
        '<div data-testid="ProductListPriceCompare"><ul><li><a href="https://prod.danawa.com/info/?pcode='+id+'" aria-label="'+config+' '+price.toLocaleString('en-US')+'?">'+price+'?</a></li></ul></div></div>').join('')+'</div>'+
      '<nav data-testid="ProductListPagination">'+data[cpu].map((_,index)=>'<button aria-label="??? '+(index+1)+'" '+(page===index+1?'aria-current="page"':'')+'>'+ (index+1)+'</button>').join('')+'</nav>';
    area.querySelector('#shipping').addEventListener('click',()=>{ includeShipping=!includeShipping; refresh(); });
    area.querySelectorAll('nav button').forEach(button=>button.addEventListener('click',()=>{
      if(missingNext)return;
      page=Number(button.textContent);refresh(false);
    }));
  }
  let includeShipping=false;
  function refresh(reset=true) {
    if(reset)page=1;
    const selected=document.querySelector('#attr-cpu-7-1'); cpu=selected.getAttribute('aria-checked')==='true'?'7':'5';
    document.getElementById('productListArea').innerHTML='<div aria-busy="true">?? ?? ?</div>';
    dom.window.clearTimeout(timer);
    if(!stuck)timer=dom.window.setTimeout(render,20);
  }
  document.querySelectorAll('[role="checkbox"]').forEach(button=>button.addEventListener('click',()=>{
    button.setAttribute('aria-checked',String(button.getAttribute('aria-checked')!=='true')); refresh();
  }));
  document.getElementById('price-search').addEventListener('click',()=>refresh());
  render();
  dom.window.eval(readExtension('danawa.js'));
  dom.window.eval(readExtension('collector.js'));
  return {dom,document,api:dom.window.ConditionPickCollector,
    stuck(value=true){stuck=value;},repeats(value=true){repeats=value;},missingNext(value=true){missingNext=value;},render};
}
export const quickTiming = {minWaitMs:10,quietMs:10,timeoutMs:1500};
