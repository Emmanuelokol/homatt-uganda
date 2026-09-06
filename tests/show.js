const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const m=require('./fmt-check.js');
const {execSync}=require('child_process');
const [title,col]=process.argv.slice(2);
const py = `
import sqlite3,sys,os
c=sqlite3.connect(require('path').join(APP, 'clinic/data/uganda_clinical_guidelines_2023.db'))
r=c.execute('select '+os.environ['COL']+' from conditions where title=?',(os.environ['TITLE'],)).fetchone()
sys.stdout.write((r[0] or '')[:1800])
`;
const t=execSync('python3 -c "$PY"',{env:{...process.env,PY:py,COL:col,TITLE:title}}).toString();
const h=m.glHtml(t,title);
console.log('════ '+title+' · '+col);
console.log(h
 .replace(/<h6 class="gl-h">/g,'\n## ').replace(/<\/h6>/g,'\n')
 .replace(/<ul class="gl-ul">/g,'').replace(/<\/ul>/g,'')
 .replace(/<li>/g,'  • ').replace(/<\/li>/g,'\n')
 .replace(/<p class="gl-p">/g,'').replace(/<p class="gl-frag">/g,'(tail) ').replace(/<\/p>/g,'\n')
 .replace(/<div class="gl-warn"><span class="material-icons-outlined">error_outline<\/span><span>/g,'\n[!] ')
 .replace(/<\/span><\/div>/g,'\n')
 .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&#39;/g,"'"));
