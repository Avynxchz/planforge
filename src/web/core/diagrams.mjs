/* PlanForge core: helper SVG dan diagram ER/alur. */

export let _pfSvgUid = 0;
export function svgEsc(s){ return String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
export function svgTrunc(s,max){ s=String(s==null?"":s); return s.length>max ? s.slice(0,Math.max(1,max-3))+"..." : s; }
export function svgWrap(text,maxChars){
  const words=String(text==null?"":text).split(/\s+/).filter(Boolean);
  const lines=[]; let cur="";
  for(const w of words){
    if(w.length>maxChars){
      if(cur){ lines.push(cur); cur=""; }
      let rest=w;
      while(rest.length>maxChars){ lines.push(rest.slice(0,maxChars)); rest=rest.slice(maxChars); }
      cur=rest;
    } else if(cur && (cur.length+1+w.length)>maxChars){ lines.push(cur); cur=w; }
    else { cur = cur ? cur+" "+w : w; }
  }
  if(cur) lines.push(cur);
  return lines.length?lines:[""];
}
export function svgLines(text,maxChars,maxLines){
  const L=svgWrap(text,maxChars);
  if(!maxLines||L.length<=maxLines) return L;
  const out=L.slice(0,maxLines);
  out[maxLines-1]=svgTrunc(out[maxLines-1]+" "+L.slice(maxLines).join(" "),maxChars);
  return out;
}
export function parseField(raw){
  const s=String(raw==null?"":raw);
  let main=s, note="";
  const dash=s.split(/\s+—\s+|\s+-\s+/);
  if(dash.length>1){ main=dash[0]; note=dash.slice(1).join(" — "); }
  main=main.trim();
  let name="", type="";
  const paren=main.match(/^([^(]+)\(([^)]*)\)\s*(.*)$/);
  const colon=main.match(/^([^:]+):\s*(.*)$/);
  if(paren && (!colon || paren[1].trim().length<=colon[1].trim().length)){
    name=paren[1].trim(); type=paren[2].trim();
    const rest=paren[3].trim(); if(rest && !note) note=rest;
  } else if(colon){ name=colon[1].trim(); type=colon[2].trim(); }
  else { name=main; type=""; }
  const tp=type.match(/^([^\s(]+)\s*\(([^)]*)\)\s*$/);
  if(tp){ type=tp[1].trim(); if(!note) note=tp[2].trim(); }
  if(!name) name=s.trim();
  return { name, type, note, raw:s, pk:false, fk:false };
}
export function erDiagramSvg(data){
  if(!Array.isArray(data)||!data.length) return "";
  const uid=++_pfSvgUid;
  const W=232, HEAD=30, ROW=21, PAD=18, GX=46, GY=54;
  const ents=data.map(e=>({
    entity:String(e&&e.entity||"").trim()||"(tanpa nama)",
    note:String(e&&e.note||""),
    fields:(Array.isArray(e&&e.fields)?e.fields:[]).map(parseField)
  }));
  const key=s=>String(s||"").toLowerCase().replace(/[^a-z0-9]/g,"");
  const sing=s=>s.endsWith("s")?s.slice(0,-1):s;
  const byKey=new Map();
  ents.forEach((e,i)=>{ const k=key(e.entity); if(k&&!byKey.has(k)) byKey.set(k,i); const ks=sing(k); if(ks&&!byKey.has(ks)) byKey.set(ks,i); });
  const PRIMS=new Set(["string","number","boolean","uuid","date","datetime","text","int","integer","float","double","decimal","json","jsonb","timestamp","timestamptz","bool","varchar","char","serial","bigserial","bigint","smallint","numeric","real","blob","bytea","enum","any","object","array","iso","id","isodate"]);
  const edges=[], seen=new Set();
  ents.forEach((e,i)=>{
    for(const f of e.fields){
      if(key(f.name)==="id") f.pk=true;
      let to=-1, why="";
      const tc=key(String(f.type).replace(/\[\]$/,"").replace(/\(.*\)/,""));
      if(tc&&!PRIMS.has(tc)&&byKey.has(tc)&&byKey.get(tc)!==i){ to=byKey.get(tc); why=f.type; }
      if(to<0){
        let base="";
        if(/_id$/i.test(f.name)) base=f.name.slice(0,-3);
        else if(/Id$/.test(f.name)&&f.name.length>2) base=f.name.slice(0,-2);
        else if(/_ref$/i.test(f.name)) base=f.name.slice(0,-4);
        const bk=sing(key(base));
        if(bk&&byKey.has(bk)&&byKey.get(bk)!==i){ to=byKey.get(bk); why=f.name; }
      }
      if(to>=0){ f.fk=true; const ek=i+">"+to+":"+key(why); if(!seen.has(ek)){ seen.add(ek); edges.push({from:i,to:to,label:f.name}); } }
    }
  });
  const cols=Math.min(3,ents.length), rows=Math.ceil(ents.length/cols);
  const boxH=e=>HEAD+Math.max(1,e.fields.length)*ROW+12;
  const rowH=[];
  for(let r=0;r<rows;r++){ let h=0; for(let c=0;c<cols;c++){ const i=r*cols+c; if(i<ents.length) h=Math.max(h,boxH(ents[i])); } rowH.push(h); }
  const pos=ents.map((e,i)=>{
    const r=Math.floor(i/cols), c=i%cols;
    let y=PAD; for(let k=0;k<r;k++) y+=rowH[k]+GY;
    const x=PAD+c*(W+GX), h=boxH(e);
    return {x,y,w:W,h,cx:x+W/2,cy:y+h/2};
  });
  const width=PAD*2+cols*W+(cols-1)*GX;
  const height=PAD*2+rowH.reduce((a,b)=>a+b,0)+(rows-1)*GY;
  const rectEdge=(p,tx,ty)=>{ const dx=tx-p.cx, dy=ty-p.cy; if(!dx&&!dy) return {x:p.cx,y:p.cy};
    const sx=dx?(p.w/2)/Math.abs(dx):Infinity, sy=dy?(p.h/2)/Math.abs(dy):Infinity, s=Math.min(sx,sy);
    return {x:p.cx+dx*s,y:p.cy+dy*s}; };
  let s='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+width+' '+height+'" width="'+width+'" height="'+height+'" style="width:100%;height:auto;max-width:'+width+'px" role="img" aria-label="Diagram ER" font-family="ui-sans-serif,system-ui,Segoe UI,Roboto,sans-serif">';
  s+='<title>Diagram ER — '+svgEsc(ents.map(e=>e.entity).join(", "))+'</title>';
  s+='<defs><marker id="pfEr'+uid+'" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#7aa2ff"/></marker></defs>';
  for(const ed of edges){
    const a=pos[ed.from], b=pos[ed.to];
    const p1=rectEdge(a,b.cx,b.cy), p2=rectEdge(b,a.cx,a.cy);
    s+='<line x1="'+p1.x.toFixed(1)+'" y1="'+p1.y.toFixed(1)+'" x2="'+p2.x.toFixed(1)+'" y2="'+p2.y.toFixed(1)+'" stroke="#7aa2ff" stroke-width="1.6" stroke-opacity="0.8" marker-end="url(#pfEr'+uid+')"><title>'+svgEsc(ed.label)+' -> '+svgEsc(ents[ed.to].entity)+'</title></line>';
    const mx=(p1.x+p2.x)/2, my=(p1.y+p2.y)/2;
    s+='<text x="'+mx.toFixed(1)+'" y="'+(my-4).toFixed(1)+'" font-size="10" fill="#9aa6bd" text-anchor="middle" paint-order="stroke" stroke="#0d1016" stroke-width="3">'+svgEsc(svgTrunc(ed.label,18))+'</text>';
  }
  ents.forEach((e,i)=>{
    const p=pos[i], hx=p.x+1, hy=p.y+1, hw=p.w-2, hh=HEAD-1, r=8;
    s+='<g><rect x="'+p.x+'" y="'+p.y+'" width="'+p.w+'" height="'+p.h+'" rx="9" fill="#141923" stroke="#242c3b"/>';
    s+='<path d="M'+hx+','+(hy+hh)+' L'+hx+','+(hy+r)+' Q'+hx+','+hy+' '+(hx+r)+','+hy+' L'+(hx+hw-r)+','+hy+' Q'+(hx+hw)+','+hy+' '+(hx+hw)+','+(hy+r)+' L'+(hx+hw)+','+(hy+hh)+' Z" fill="#1a2130"/>';
    s+='<path d="M'+p.x+','+(p.y+HEAD)+' h'+p.w+'" stroke="#242c3b"/>';
    s+='<g><title>'+svgEsc(e.entity)+(e.note?" — "+svgEsc(e.note):"")+'</title><text x="'+(p.x+11)+'" y="'+(p.y+20)+'" font-size="13" font-weight="700" fill="#5ee0b8">'+svgEsc(svgTrunc(e.entity,28))+'</text></g>';
    e.fields.forEach((f,k)=>{
      const fy=p.y+HEAD+ROW*(k+1)-6, tag=f.pk?"PK":(f.fk?"FK":"");
      const label=f.name+(f.type?" : "+f.type:"");
      s+='<g><title>'+svgEsc(f.raw)+'</title><text x="'+(p.x+11)+'" y="'+fy+'" font-size="11.5" fill="'+(f.fk?"#7aa2ff":"#9aa6bd")+'">'+svgEsc(svgTrunc(label,tag?24:30))+'</text>';
      if(tag) s+='<text x="'+(p.x+p.w-11)+'" y="'+fy+'" font-size="9" font-weight="700" fill="'+(f.pk?"#5ee0b8":"#7aa2ff")+'" text-anchor="end">'+tag+'</text>';
      s+='</g>';
    });
    s+='</g>';
  });
  s+='</svg>';
  return s;
}
export function sequenceDiagramSvg(flows){
  if(!Array.isArray(flows)||!flows.length) return "";
  const uid=++_pfSvgUid;
  const LW=250, GX=28, PAD=18, HEAD=52, NW=210, GAP=24;
  const lanes=flows.map(f=>{
    const name=String(f&&f.name||"").trim()||"(alur)", phase=String(f&&f.phase_ref||"");
    const steps=(Array.isArray(f&&f.steps)?f.steps:[]).map(x=>String(x==null?"":x));
    const nameLines=svgLines(name,26,2);
    const nodes=steps.map((st,idx)=>{ const lines=svgLines(st,28,3); return {idx:idx+1,lines,h:14+lines.length*15+6,raw:st}; });
    const headH=HEAD+(nameLines.length-1)*15;
    const bodyH=nodes.reduce((a,n)=>a+n.h+GAP,0);
    return {name,phase,nameLines,nodes,headH,height:headH+bodyH+10};
  });
  const width=PAD*2+lanes.length*LW+(lanes.length-1)*GX;
  const height=PAD*2+Math.max.apply(null,lanes.map(l=>l.height));
  let s='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+width+' '+height+'" width="'+width+'" height="'+height+'" style="width:100%;height:auto;max-width:'+width+'px" role="img" aria-label="Diagram alur" font-family="ui-sans-serif,system-ui,Segoe UI,Roboto,sans-serif">';
  s+='<title>Diagram alur — '+svgEsc(lanes.map(l=>l.name).join(", "))+'</title>';
  s+='<defs><marker id="pfSeq'+uid+'" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#6b7694"/></marker></defs>';
  lanes.forEach((l,li)=>{
    const x=PAD+li*(LW+GX), cx=x+LW/2;
    s+='<text x="'+cx+'" y="'+(PAD+18)+'" font-size="13" font-weight="700" fill="#5ee0b8" text-anchor="middle">';
    l.nameLines.forEach((ln,j)=>{ s+='<tspan x="'+cx+'" dy="'+(j===0?0:15)+'">'+svgEsc(ln)+'</tspan>'; });
    s+='</text>';
    if(l.phase) s+='<text x="'+cx+'" y="'+(PAD+18+l.nameLines.length*15+2)+'" font-size="10" fill="#6b7694" text-anchor="middle">'+svgEsc(svgTrunc(l.phase,30))+'</text>';
    const topY=PAD+l.headH, botY=PAD+l.height-10;
    s+='<line x1="'+cx+'" y1="'+topY+'" x2="'+cx+'" y2="'+botY+'" stroke="#242c3b" stroke-width="1.5" stroke-dasharray="4 4"/>';
    let y=topY+6;
    l.nodes.forEach((n,k)=>{
      const nx=cx-NW/2;
      if(k>0) s+='<line x1="'+cx+'" y1="'+(y-GAP+2)+'" x2="'+cx+'" y2="'+(y-2)+'" stroke="#6b7694" stroke-width="1.6" marker-end="url(#pfSeq'+uid+')"/>';
      s+='<g><title>'+svgEsc(n.raw)+'</title><rect x="'+nx+'" y="'+y+'" width="'+NW+'" height="'+n.h+'" rx="8" fill="#1a2130" stroke="#242c3b"/>';
      s+='<circle cx="'+(nx+16)+'" cy="'+(y+n.h/2)+'" r="9" fill="#7aa2ff"/>';
      s+='<text x="'+(nx+16)+'" y="'+(y+n.h/2+3.5)+'" font-size="10" font-weight="700" fill="#0d1016" text-anchor="middle">'+n.idx+'</text>';
      n.lines.forEach((ln,j)=>{ s+='<text x="'+(nx+32)+'" y="'+(y+18+j*15)+'" font-size="11.5" fill="#e7ecf5">'+svgEsc(ln)+'</text>'; });
      s+='</g>';
      y+=n.h+GAP;
    });
  });
  s+='</svg>';
  return s;
}
