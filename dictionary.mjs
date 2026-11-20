import {readFile} from 'node:fs/promises';
export async function dictionary() {
  const raw=await readFile(new URL('./dictionary.tsv',import.meta.url),'utf8');
  const keys=new Set();
  return raw.replace(/^\uFEFF/,'').trim().split(/\r?\n/).map((line,index)=>{
    const entries=line.split('\t');
    const [source,...translations]=entries;
    const punctuation=value=>(value.match(/[:.();,={}\[\]<>]/g)||[]).join('');
    if(entries.length!==5||keys.has(source)||!source||translations.some(value=>
      !value||/[：．。（）；，＝｛｝［］＜＞]/u.test(value)||punctuation(source)!==punctuation(value)
    )) throw Error('Invalid dictionary line '+(index+1));
    keys.add(source);
    return entries;
  });
}
if (process.argv.includes('--validate')) console.log('Validated '+(await dictionary()).length+' entries');
