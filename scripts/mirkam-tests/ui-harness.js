import fs from 'node:fs';
import vm from 'node:vm';
class Element {
 constructor(tag){this.tag=tag;this.children=[];this.value='';this.disabled=false;this.hidden=false;this.textContent='';this.attrs={};}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this.children=nodes;}
 setAttribute(k,v){this.attrs[k]=v;}
 removeAttribute(k){delete this.attrs[k];}
 scrollIntoView(){this.revealed=true;}
}
function ui(fetcher=async()=>new Response('{"ok":true}',{headers:{'content-type':'application/json'}})){
 const ids=new Map(),all=[];const html=fs.readFileSync(new URL('../../public/mirkam/index.html',import.meta.url),'utf8');
 for(const match of html.matchAll(/id="([^"]+)"/g)){const n=new Element('element');ids.set(match[1],n);all.push(n);}
 const classes=new Set();
 const window={addEventListener(){},dispatchEvent(){},confirm:()=>true};const document={body:{classList:{add(c){classes.add(c);},remove(c){classes.delete(c);},contains(c){return classes.has(c);}}},getElementById:id=>ids.get(id)||null,createElement:tag=>{const n=new Element(tag);all.push(n);return n;},querySelectorAll:()=>all.filter(n=>n.tag==='button')};
 const context=vm.createContext({window,document,navigator:{onLine:true},fetch:fetcher,AbortController,Event,setTimeout:(fn,ms)=>{const t=setTimeout(fn,ms);t.unref();return t;},clearTimeout,URL,console});
 vm.runInContext(fs.readFileSync(new URL('../../public/mirkam/app.js',import.meta.url),'utf8'),context);
 return {ids,all,context,window,submit:id=>ids.get(id).onsubmit({preventDefault(){}}),click:id=>ids.get(id).onclick(),text:id=>{const text=n=>[n.textContent,...n.children.map(text)].join(' ');return text(ids.get(id));}};
}
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json'}});

export {ui,json,Element};
