import { short } from "../text.mjs";

export const SEL = (s)=>JSON.stringify(String(s));

export const AMBIL = (s)=>"document.querySelector(" + SEL(s) + ")";

export function ekspresiCheck(c){
  switch(c.type){
    case "text": return "(()=>{const e=" + AMBIL(c.selector) + ";return e?{ada:true,teks:(e.textContent||'').trim()}:{ada:false};})()";
    case "count": return "document.querySelectorAll(" + SEL(c.selector) + ").length";
    case "visible": return "(()=>{const e=" + AMBIL(c.selector) + ";if(!e)return{ada:false};const r=e.getBoundingClientRect(),s=getComputedStyle(e);return{ada:true,lebar:r.width,tinggi:r.height,display:s.display,visibility:s.visibility};})()";
    case "attr": return "(()=>{const e=" + AMBIL(c.selector) + ";return e?{ada:true,nilai:e.getAttribute(" + SEL(c.name) + ")}:{ada:false};})()";
    case "canvasNotBlank": return "(()=>{const c=" + AMBIL(c.selector) + ";if(!c)return{ada:false};if(String(c.tagName).toLowerCase()!=='canvas')return{ada:true,canvas:false};const x=c.getContext('2d');if(!x)return{ada:true,canvas:true,pixel:null};const d=x.getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i]!==0)n++;return{ada:true,canvas:true,pixel:n,total:c.width*c.height};})()";
    case "click": return "(()=>{const e=" + AMBIL(c.selector) + ";if(!e)return{ada:false};e.scrollIntoView({block:'center'});e.click();return{ada:true};})()";
    case "noHorizontalOverflow": return "({scroll:document.documentElement.scrollWidth,inner:window.innerWidth})";
    case "url": return "({href:location.href})";
    default: return "null";
  }
}

export function nilaiCheck(c, ukur, konteks){
  const gagal = (alasan)=>({ pass: false, alasan });
  switch(c.type){
    case "text": {
      if(!ukur || !ukur.ada) return gagal("selector " + c.selector + " tidak ada di halaman");
      const teks = String(ukur.teks || "");
      if(c.equals != null && teks !== String(c.equals)) return gagal("teks \"" + short(teks, 80) + "\" ≠ \"" + short(c.equals, 60) + "\"");
      if(c.contains && !teks.includes(String(c.contains))) return gagal("teks \"" + short(teks, 80) + "\" tidak memuat \"" + short(c.contains, 60) + "\"");
      if(c.matches && !new RegExp(c.matches).test(teks)) return gagal("teks \"" + short(teks, 80) + "\" tidak cocok /" + short(c.matches, 60) + "/");
      return { pass: true };
    }
    case "count": {
      const n = Number(ukur);
      if(c.equals != null && n !== Number(c.equals)) return gagal("jumlah " + n + " ≠ " + c.equals);
      if(c.min != null && n < Number(c.min)) return gagal("jumlah " + n + " < minimum " + c.min);
      if(c.max != null && n > Number(c.max)) return gagal("jumlah " + n + " > maksimum " + c.max);
      return { pass: true };
    }
    case "visible": {
      if(!ukur || !ukur.ada) return gagal("selector " + c.selector + " tidak ada di halaman");
      if(ukur.display === "none" || ukur.visibility === "hidden") return gagal("elemen ada tapi tidak terlihat (display " + ukur.display + ", visibility " + ukur.visibility + ")");
      if(!(ukur.lebar > 0 && ukur.tinggi > 0)) return gagal("ukuran elemen " + ukur.lebar + "×" + ukur.tinggi + " — nol, jadi tidak kelihatan");
      return { pass: true };
    }
    case "attr": {
      if(!ukur || !ukur.ada) return gagal("selector " + c.selector + " tidak ada di halaman");
      const nilai = ukur.nilai;
      if(c.equals != null && nilai !== String(c.equals)) return gagal("atribut " + c.name + " = \"" + short(nilai, 60) + "\" ≠ \"" + short(c.equals, 60) + "\"");
      if(c.contains && !String(nilai || "").includes(String(c.contains))) return gagal("atribut " + c.name + " tidak memuat \"" + short(c.contains, 60) + "\"");
      return { pass: true };
    }
    case "canvasNotBlank": {
      if(!ukur || !ukur.ada) return gagal("selector " + c.selector + " tidak ada di halaman");
      if(ukur.canvas === false) return gagal(c.selector + " bukan elemen <canvas>");
      if(ukur.pixel == null) return gagal("canvas tidak bisa diukur (konteks 2d tidak tersedia) — worker tidak mau menebak");
      const min = c.minPixels == null ? 1 : Number(c.minPixels);
      if(ukur.pixel < min) return gagal("canvas " + c.selector + " hanya " + ukur.pixel + " pixel terisi dari " + ukur.total + " (minimum " + min + ") — kosong, tidak menggambar apa pun");
      return { pass: true };
    }
    case "click": return ukur && ukur.ada ? { pass: true } : gagal("selector " + c.selector + " tidak ada, jadi tidak bisa diklik");
    case "request": {
      const cocok = konteks.requests.filter(u=> c.urlContains ? u.includes(String(c.urlContains)) : new RegExp(c.urlMatches).test(u));
      return cocok.length ? { pass: true } : gagal("tidak ada request yang memuat \"" + short(c.urlContains || c.urlMatches, 70) + "\" — fetch-nya tidak pernah jalan");
    }
    case "url": {
      const href = String((ukur && ukur.href) || "");
      if(c.equals != null && href !== String(c.equals)) return gagal("alamat halaman \"" + short(href, 90) + "\" ≠ \"" + short(c.equals, 60) + "\"");
      if(c.contains && !href.includes(String(c.contains))) return gagal("alamat halaman \"" + short(href, 90) + "\" tidak memuat \"" + short(c.contains, 60) + "\" — URL tidak diperbarui");
      if(c.matches && !new RegExp(c.matches).test(href)) return gagal("alamat halaman \"" + short(href, 90) + "\" tidak cocok /" + short(c.matches, 60) + "/");
      return { pass: true };
    }
    case "noConsoleError": return konteks.errors.length
      ? gagal(konteks.errors.length + " error console: " + short(konteks.errors.join(" | "), 300))
      : { pass: true };
    case "noHorizontalOverflow": return ukur && ukur.scroll > ukur.inner + 1
      ? gagal("lebar konten " + ukur.scroll + "px > viewport " + ukur.inner + "px — ada overflow horizontal")
      : { pass: true };
    case "wait": return { pass: true };
    default: return gagal("type tidak dikenal");
  }
}
