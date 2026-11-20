export function parseArgs(argv){
  const a = { _: [] };
  for(let i=0;i<argv.length;i++){
    const x = argv[i];
    if(x.startsWith("--")){
      const k = x.slice(2); const nx = argv[i+1];
      if(nx === undefined || nx.startsWith("--")) a[k] = true; else { a[k] = nx; i++; }
    } else a._.push(x);
  }
  return a;
}
