/* Automatische Tests für Garten-Flo Büro.
   Start: npm test  (lädt buero.html in einem unsichtbaren Chromium und prüft
   Rechenlogik, Rechnungstexte und den Start aller Hauptansichten). */
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const path=require('path'),fs=require('fs');
const {chromium}=require('playwright');

const FILE='file://'+path.resolve(__dirname,'..','buero.html');
let browser,page,errors=[];

before(async()=>{
  browser=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{});
  page=await browser.newPage({viewport:{width:390,height:844}});
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(FILE);
  await page.waitForFunction(()=>typeof totals==='function'&&typeof db==='object');
});
after(async()=>{await browser&&browser.close();});
const ev=(fn,arg)=>page.evaluate(fn,arg);

test('index.html und buero.html sind identisch',()=>{
  const a=fs.readFileSync(path.resolve(__dirname,'..','buero.html'));
  const b=fs.readFileSync(path.resolve(__dirname,'..','index.html'));
  assert.ok(a.equals(b),'index.html muss eine Kopie von buero.html sein');
});

test('App startet ohne JavaScript-Fehler',()=>{assert.deepEqual(errors,[]);});

test('Summen: Kleinunternehmer ohne USt, Regelbesteuerung mit 19 %',async()=>{
  const r=await ev(()=>{
    const pos=[{qty:2,price:45},{qty:1,price:55}];
    return {klein:totals({positions:pos,klein:true,vat:19}),regel:totals({positions:pos,klein:false,vat:19})};
  });
  assert.deepEqual(r.klein,{net:145,vat:0,gross:145});
  assert.equal(r.regel.net,145);
  assert.ok(Math.abs(r.regel.vat-27.55)<1e-9);
  assert.ok(Math.abs(r.regel.gross-172.55)<1e-9);
});

test('Offener Betrag: Teilzahlungen und Abschläge werden abgezogen',async()=>{
  const r=await ev(()=>{
    const d={positions:[{qty:10,price:45}],klein:true,payments:[{amount:100},{amount:50.5}],abzuege:[{gross:120}]};
    return {paid:paid(d),payable:payable(d),offen:offenOf(d)};
  });
  assert.deepEqual(r,{paid:150.5,payable:330,offen:179.5});
});

test('Ausgaben: Einordnung Verbrauch / GWG / Anlagegut',async()=>{
  const r=await ev(()=>({
    mulch:classify({desc:'Rindenmulch 3 m³',amount:278,vat:19}),
    km:classify({desc:'Fahrt',category:'Fahrtkosten (km)',amount:9}),
    klein:classify({desc:'Heckenschere',amount:200,vat:19}),
    gwg:classify({desc:'Rasenmäher',amount:700,vat:19}),
    anlage:classify({desc:'Rasenmäher Aufsitz',amount:2500,vat:19})
  }));
  assert.equal(r.mulch,'verbrauch');
  assert.equal(r.km,'betrieb');
  assert.equal(r.klein,'verbrauch');   /* netto unter 250 € */
  assert.equal(r.gwg,'gwg');           /* netto 588 € */
  assert.equal(r.anlage,'anlage');     /* netto über 800 € */
});

test('Ausgaben: Nettobetrag und Nutzungsdauer',async()=>{
  const r=await ev(()=>({net:netOf({amount:119,vat:19}),net0:netOf({amount:50,vat:0}),def:netOf({amount:119}),
    nd1:ndFor('iPhone 16'),nd2:ndFor('Motorsäge'),nd3:ndFor('Häcksler'),nd4:ndFor('Irgendwas')}));
  assert.ok(Math.abs(r.net-100)<1e-9);assert.equal(r.net0,50);assert.ok(Math.abs(r.def-100)<1e-9);
  assert.deepEqual([r.nd1,r.nd2,r.nd3,r.nd4],[1,7,8,8]);
});

test('Datum: Ortszeit und Monatswechsel',async()=>{
  const r=await ev(()=>({a:addDays('2026-11-25',7),b:addDays('2026-03-28',2),c:dDE('2026-11-25')}));
  assert.deepEqual(r,{a:'2026-12-02',b:'2026-03-30',c:'25.11.2026'});
});

test('Leistungsdatum: Tag, Zeitraum, mehrere Termine',async()=>{
  const r=await ev(()=>({
    tag:leistungsText({deliveryDate:'2026-11-18'}),
    zr:leistungsText({deliveryMode:'zeitraum',deliveryDate:'2026-11-16',deliveryEnd:'2026-11-18'}),
    t:leistungsText({deliveryMode:'termine',deliveryDates:['2026-11-18','2026-11-04']})
  }));
  assert.equal(r.tag,'18.11.2026');
  assert.equal(r.zr,'16.11.2026 – 18.11.2026');
  assert.equal(r.t,'04.11.2026, 18.11.2026');
});

test('Rechnungsnummern: vergebene Nummern werden übersprungen, Entwürfe nicht',async()=>{
  const r=await ev(()=>{
    const bak=JSON.stringify({inv:db.invoices,nk:db.settings.numbers});
    db.settings.numbers={...db.settings.numbers,invPrefix:'RE-',invNext:26001,invJahr:false};
    db.invoices=[{number:'RE-26001'},{number:'RE-26002'},{number:'RE-26003',draft:true}];
    const n=nrFrei();
    const o=JSON.parse(bak);db.invoices=o.inv;db.settings.numbers=o.nk;
    return n;
  });
  assert.equal(r,'RE-26003');
});

test('Rechnungsnummern mit Jahr starten bei JJ001',async()=>{
  const r=await ev(()=>{
    const bak=JSON.stringify({inv:db.invoices,nk:db.settings.numbers});
    db.settings.numbers={...db.settings.numbers,invPrefix:'RE-',invNext:5,invJahr:true};
    db.invoices=[];
    const n=nrFrei(),jj=new Date().getFullYear()%100;
    const o=JSON.parse(bak);db.invoices=o.inv;db.settings.numbers=o.nk;
    return {n,erwartet:'RE-'+(jj*1000+1)};
  });
  assert.equal(r.n,r.erwartet);
});

test('Rechnungstext: Fälligkeit steht nur einmal da',async()=>{
  const r=await ev(()=>({s:zahlSatz({dueDate:'2026-11-25'}),v:VERZUG_HINWEIS}));
  assert.match(r.s,/bis zum 25\.11\.2026/);
  assert.doesNotMatch(r.s,/innerhalb von/);
  assert.equal((r.s.match(/\d\d\.\d\d\.\d{4}/g)||[]).length,1);
  assert.match(r.v,/§ 286 Abs\. 3 BGB/);
});

test('Kunden: Name aus Vor- und Nachname, Firma hat Vorrang, Altdaten werden aufgeteilt',async()=>{
  const r=await ev(()=>({
    p:custName({first:'Anna',last:'Meier'}),f:custName({company:'Muster GmbH',first:'Anna',last:'Meier'}),
    m:(()=>{const c=migCustomer({name:'Hans Peter Müller'});return [c.first,c.last];})()
  }));
  assert.equal(r.p,'Anna Meier');assert.equal(r.f,'Muster GmbH');assert.deepEqual(r.m,['Hans Peter','Müller']);
});

test('Festgeschriebene Rechnung lässt sich nicht löschen',async()=>{
  const r=await ev(()=>{
    const bak=JSON.stringify(db.invoices);let msg='';const oa=window.alert;window.alert=m=>{msg=m;};
    db.invoices=[{id:'t1',number:'RE-99001',positions:[],date:'2026-11-18'}];
    try{delDoc('invoice','t1');}catch(e){}
    const noch=db.invoices.some(i=>i.id==='t1');
    window.alert=oa;db.invoices=JSON.parse(bak);
    return {noch,msg};
  });
  assert.equal(r.noch,true);
  assert.match(r.msg,/festgeschrieben/);
});

test('Hauptansichten öffnen ohne Fehler',async()=>{
  const before=errors.length;
  for(const t of ['start','jobs','kunden','geld','more']){
    await ev(t=>go(t),t);await page.waitForTimeout(150);
  }
  assert.deepEqual(errors.slice(before),[]);
});

test('Rechnung als PDF erzeugen ohne Fehler',async()=>{
  const r=await ev(async()=>{
    const bak=JSON.stringify({c:db.customers,i:db.invoices});
    db.customers=[{id:'k1',first:'Anna',last:'Meier',street:'Weg 1',zip:'91085',city:'Weisendorf'}];
    const d={id:'p1',number:'RE-99002',customerId:'k1',date:'2026-11-18',deliveryDate:'2026-11-18',dueDate:'2026-11-25',
      klein:true,vat:19,positions:[{desc:'An- und Abfahrt inkl. Verschleiß und Betriebskosten',unit:'Pauschal',qty:1,price:55}],payments:[],draft:true};
    db.invoices=[d];
    let ok=false,err='';
    /* alle Texte mitschreiben, die ins PDF gezeichnet werden */
    const Orig=window.jspdf.jsPDF,texte=[];
    window.jspdf.jsPDF=function(...a){const doc=new Orig(...a),t=doc.text;
      doc.text=function(x,...r){texte.push(Array.isArray(x)?x.join(' '):String(x));return t.call(this,x,...r);};return doc;};
    try{const out=await genPdf('invoice','p1','Rechnung');ok=!!out;}catch(e){err=String(e&&e.message||e);}
    window.jspdf.jsPDF=Orig;const raw=texte.join('\n');
    const o=JSON.parse(bak);db.customers=o.c;db.invoices=o.i;
    return {ok,err,faellig:(raw.match(/25\.11\.2026/g)||[]).length,alt:/Rechnungseingang/.test(raw)};
  });
  assert.equal(r.err,'');
  assert.equal(r.ok,true);
  assert.equal(r.alt,false,'alter Satz "innerhalb von X Tagen ab Rechnungseingang" darf nicht mehr im PDF stehen');
  assert.equal(r.faellig,1,'Fälligkeitsdatum genau einmal im PDF');
});

/* ---------- 5.2: Daten sicher ---------- */
test('Speichern landet zusätzlich in IndexedDB',async()=>{
  const r=await ev(async()=>{
    db.customers.push({id:'idbtest1',first:'Ida',last:'Bauer'});
    const ok=await persistDb();
    const rec=await idbGet();
    return {ok,drin:!!rec&&rec.data.includes('idbtest1'),ls:(localStorage.getItem(LS)||'').includes('idbtest1')};
  });
  assert.deepEqual(r,{ok:true,drin:true,ls:true});
});

test('GitHub-Sync verweigert öffentliche Repositories',async()=>{
  const r=await ev(async()=>{
    const of=window.fetch;let putGerufen=false;
    window.fetch=async(url,o)=>{
      if(/\/repos\/[^/]+\/[^/]+$/.test(url))return new Response(JSON.stringify({private:false}),{status:200});
      putGerufen=true;return new Response('{}',{status:200});
    };
    let msg='';try{await ghPut({owner:'x',repo:'oeffentlich',token:'t',path:'d.json'},{a:1});}catch(e){msg=e.message;}
    window.fetch=of;return {msg,putGerufen};
  });
  assert.match(r.msg,/öffentlich/);
  assert.equal(r.putGerufen,false);
});

test('GitHub-Sync erlaubt private Repositories',async()=>{
  const r=await ev(async()=>{
    const of=window.fetch;let putGerufen=false;
    window.fetch=async(url,o)=>{
      if(/\/repos\/[^/]+\/[^/]+$/.test(url))return new Response(JSON.stringify({private:true}),{status:200});
      if(o&&o.method==='PUT'){putGerufen=true;return new Response(JSON.stringify({content:{sha:'abc'}}),{status:200});}
      return new Response('{}',{status:200});
    };
    let msg='';try{await ghPut({owner:'x',repo:'privat',token:'t',path:'d.json'},{a:1});}catch(e){msg=e.message;}
    window.fetch=of;return {msg,putGerufen};
  });
  assert.equal(r.putGerufen,true,r.msg);
});

test('App-Sperre: falsche PIN sperrt weiter, richtige entsperrt',async()=>{
  const r=await ev(async()=>{
    const salt='abcd';localStorage.setItem('buero_pin',JSON.stringify({salt,hash:await pinHash('2468',salt),min:5}));
    pinLock();const da=!!document.getElementById('pinLock');
    document.getElementById('pinIn').value='1111';document.getElementById('pinGo').click();
    await new Promise(r=>setTimeout(r,100));
    const nochDa=!!document.getElementById('pinLock');
    document.getElementById('pinIn').value='2468';document.getElementById('pinGo').click();
    await new Promise(r=>setTimeout(r,100));
    const weg=!document.getElementById('pinLock');
    const menue=vMehr().includes('App-Sperre');
    localStorage.removeItem('buero_pin');
    return {da,nochDa,weg,menue};
  });
  assert.deepEqual(r,{da:true,nochDa:true,weg:true,menue:true});
});

test('Browserspeicher leer: Daten kommen aus IndexedDB zurück',async()=>{
  await ev(async()=>{db.customers.push({id:'idbtest2',first:'Leo',last:'Leer'});await persistDb();localStorage.removeItem(LS);});
  await page.reload();
  await page.waitForFunction(()=>typeof db==='object'&&db.customers.some(c=>c.id==='idbtest2'),null,{timeout:5000});
  const ls=await ev(async()=>{await new Promise(r=>setTimeout(r,300));return (localStorage.getItem(LS)||'').includes('idbtest2');});
  assert.equal(ls,true,'nach dem Laden wieder im Browserspeicher');
});

test('Browserspeicher voll: App speichert weiter und lädt aus IndexedDB',async()=>{
  const r=await ev(async()=>{
    const orig=Storage.prototype.setItem;
    Storage.prototype.setItem=function(k,v){if(k===LS)throw new DOMException('voll','QuotaExceededError');return orig.call(this,k,v);};
    db.customers.push({id:'idbtest3',first:'Vera',last:'Voll'});
    const ok=await persistDb();
    Storage.prototype.setItem=orig;
    return {ok,flag:localStorage.getItem(LS+'_nurIdb'),lsWeg:localStorage.getItem(LS)===null};
  });
  assert.deepEqual(r,{ok:true,flag:'1',lsWeg:true});
  await page.reload();
  await page.waitForFunction(()=>typeof db==='object'&&db.customers.some(c=>c.id==='idbtest3'),null,{timeout:5000});
  const flag=await ev(async()=>{await new Promise(r=>setTimeout(r,300));return localStorage.getItem(LS+'_nurIdb');});
  assert.equal(flag,null,'passt wieder in den Browserspeicher → Merker weg');
});

/* ---------- 5.3: Design Waldgrün ---------- */
test('Heute zeigt vier Kennzahlen aus echten Daten',async()=>{
  const r=await ev(()=>{
    const bak=JSON.stringify({i:db.invoices,j:db.jobs,f:db.fahrten});const t=today();
    db.invoices=[{id:'k1',number:'RE-1',date:t,dueDate:addDays(t,-1),klein:true,positions:[{qty:1,price:220}],payments:[]},
      {id:'k2',number:'RE-2',date:t,dueDate:addDays(t,5),klein:true,positions:[{qty:1,price:100}],payments:[{date:t,amount:40}]}];
    db.jobs=[{id:'kj',customerId:'c',date:t,status:'erledigt',preis:150}];
    db.fahrten=[{id:'kf',date:t,km:12.4},{id:'kf2',date:t,km:3.6}];
    const h=kzKacheln();
    const o=JSON.parse(bak);db.invoices=o.i;db.jobs=o.j;db.fahrten=o.f;
    return h;
  });
  assert.match(r,/Eingegangen/);
  assert.match(r,/40 €/);                 /* Zahlungseingang */
  assert.match(r,/280 €/);                /* offen: 220 + 60 */
  assert.match(r,/1 überfällig/);
  assert.match(r,/1 Auftrag/);
  assert.match(r,/16 km/);
});

test('Plus-Knopf sitzt in der unteren Leiste',async()=>{
  const r=await ev(()=>{drawTabs();const b=document.querySelector('#tabs .tplus');return {da:!!b,pos:[...document.getElementById('tabs').children].indexOf(b)};});
  assert.deepEqual(r,{da:true,pos:2});
});

test('Am Mac steht die Navigation als Seitenleiste links',async()=>{
  const p2=await browser.newPage({viewport:{width:1400,height:900}});
  await p2.goto(FILE);await p2.waitForFunction(()=>typeof db==='object');
  const r=await p2.evaluate(()=>{const s=getComputedStyle(document.getElementById('tabs'));return {left:s.left,w:s.width,dir:s.flexDirection};});
  await p2.close();
  assert.deepEqual(r,{left:'0px',w:'232px',dir:'column'});
});

/* ---------- 5.4: Angebot → Auftrag → Rechnung ---------- */
test('Angebot wird mit einem Tipp zum Auftrag, Rechnung übernimmt die Positionen',async()=>{
  const r=await ev(()=>{
    const bak=JSON.stringify({c:db.customers,o:db.offers,j:db.jobs,i:db.invoices});
    db.customers.push({id:'ac1',first:'Anna',last:'Meier',street:'Lindenweg 12',zip:'91085',city:'Weisendorf',kmRoundtrip:16});
    db.offers.push({id:'ao1',number:'AN-900',customerId:'ac1',date:today(),dueDate:addDays(today(),30),status:'offen',klein:true,
      positions:[{desc:'Heckenschnitt',qty:3,unit:'Std',price:45},{desc:'Grüngut aufladen und abtransportieren',qty:1,unit:'pauschal',price:40},
        {desc:'An- und Abfahrt inkl. Verschleiß und Betriebskosten',qty:1,unit:'Pauschal',price:55}]});
    offerToJob('ao1');
    const job={titel:curJob.titel,preis:curJob.preis,dauer:curJob.dauer,kunde:curJob.customerId,offerId:curJob.offerId};
    saveJob();
    const o=db.offers.find(x=>x.id==='ao1'),j=db.jobs.find(x=>x.offerId==='ao1');
    const verkn={jobId:o.jobId===j.id,status:o.status};
    viewDoc('offer','ao1');
    const knopf=(document.getElementById('o_job')||{}).textContent||'';
    closeSheets();
    j.status='erledigt';
    jobZuRechnung(j.id);
    const pos=cur.positions.map(p=>p.desc),von=cur.fromOffer,jid=cur.jobId===j.id;
    closeSheets();
    editJob(j.id);
    const kette=(document.getElementById('j_kette')||{}).textContent||'';
    closeSheets();
    const b=JSON.parse(bak);db.customers=b.c;db.offers=b.o;db.jobs=b.j;db.invoices=b.i;cur=null;
    return {job,verkn,knopf,pos,von,jid,kette};
  });
  assert.deepEqual(r.job,{titel:'Heckenschnitt',preis:230,dauer:3,kunde:'ac1',offerId:'ao1'});
  assert.deepEqual(r.verkn,{jobId:true,status:'angenommen'});
  assert.match(r.knopf,/Zum Auftrag/);
  assert.deepEqual(r.pos,['Heckenschnitt','Grüngut aufladen und abtransportieren','An- und Abfahrt inkl. Verschleiß und Betriebskosten']);
  assert.equal(r.von,'AN-900');
  assert.equal(r.jid,true);
  assert.match(r.kette,/Angebot/);
  assert.match(r.kette,/✓ Erledigt/);
  assert.doesNotMatch(r.kette,/✓ Abgerechnet/);
});

test('Auftrag mit Rechnungsentwurf öffnet den Entwurf statt einen zweiten anzulegen',async()=>{
  const r=await ev(()=>{
    const bak=JSON.stringify({j:db.jobs,i:db.invoices});
    db.jobs.push({id:'aj2',customerId:'',titel:'Rasen',date:today(),status:'erledigt',preis:80});
    db.invoices.push({id:'ai2',number:'RE-Entwurf',draft:true,jobId:'aj2',date:today(),dueDate:today(),positions:[{desc:'Rasen',qty:1,price:80}],payments:[]});
    const vorher=db.invoices.length;
    jobZuRechnung('aj2');
    const res={gleich:db.invoices.length===vorher,offen:cur&&cur.id};
    closeSheets();
    const b=JSON.parse(bak);db.jobs=b.j;db.invoices=b.i;cur=null;
    return res;
  });
  assert.deepEqual(r,{gleich:true,offen:'ai2'});
});

test('Keine JavaScript-Fehler im ganzen Testlauf',()=>{assert.deepEqual(errors,[]);});
