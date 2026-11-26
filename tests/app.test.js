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

/* ---------- 5.5: Auswertungen ---------- */
test('Auswertungen: Umsatz nach Kunde und Leistung, ohne Stornos und doppelte Abschläge',async()=>{
  const r=await ev(()=>{
    const bak=JSON.stringify({c:db.customers,i:db.invoices,it:db.items});
    const y=+today().slice(0,4),d=y+'-03-10';
    db.customers.push({id:'wk1',name:'Huber',first:'Hans',last:'Huber'},{id:'wk2',name:'Wagner',first:'Eva',last:'Wagner'});
    db.items.push({id:'wi1',name:'Heckenschnitt',unit:'Std',price:45});
    const R=(id,c,pos,x)=>Object.assign({id,number:'T-'+id,customerId:c,date:d,deliveryDate:d,klein:true,positions:pos,payments:[]},x||{});
    db.invoices.push(
      R('w1','wk1',[{desc:'Heckenschnitt Thuja',qty:4,unit:'Std',price:45},{desc:'An- und Abfahrt inkl. Verschleiß und Betriebskosten',qty:1,unit:'Pauschal',price:55}]),
      R('w2','wk2',[{desc:'Heckenschnitt',qty:2,unit:'Std',price:45}]),
      R('w3','wk2',[{desc:'Rasen mähen, Kanten',qty:1,unit:'pauschal',price:100}],{storniertDurch:'w4'}),
      R('w4','wk2',[{desc:'Rasen mähen, Kanten',qty:1,unit:'pauschal',price:-100}],{stornoVon:'w3'}),
      R('w5','wk1',[{desc:'Abschlag Pflasterarbeiten',qty:1,unit:'pauschal',price:500}],{art:'abschlag',verrechnetIn:'w6'}),
      R('w6','wk1',[{desc:'Pflasterarbeiten',qty:1,unit:'pauschal',price:1200}],{art:'schluss',abzuege:[{gross:500}]}),
      R('w7','wk1',[{desc:'Entwurf',qty:1,unit:'pauschal',price:999}],{draft:true}));
    const k=awNachKunde(y).filter(x=>['wk1','wk2'].includes(x.c.id)).map(x=>[x.c.id,x.umsatz,x.n]);
    const l=Object.fromEntries(awNachLeistung(y).map(x=>[x.name,x.umsatz]));
    yGeld=y;const geld=vGeld().includes('openAusw(yGeld)');
    openAusw(y);const html=(document.getElementById('awbody')||{}).textContent||'';closeSheets();
    const b=JSON.parse(bak);db.customers=b.c;db.invoices=b.i;db.items=b.it;
    return {k,l,geld,html};
  });
  assert.deepEqual(r.k,[['wk1',1435,2],['wk2',90,1]]);
  assert.equal(r.l['Heckenschnitt'],270);
  assert.equal(r.l['An- und Abfahrt'],55);
  assert.equal(r.l['Pflasterarbeiten'],1200);
  assert.equal(r.l['Rasen mähen'],undefined);
  assert.equal(r.l['Abschlag Pflasterarbeiten'],undefined);
  assert.ok(r.geld,'Eintrag unter Geld');
  assert.match(r.html,/Umsatz nach Kunde/);
  assert.match(r.html,/Gewinn laut EÜR/);
  assert.match(r.html,/Huber/);
});

test('Auswertungen: Vergleich mit gleichem Zeitraum im Vorjahr',async()=>{
  const r=await ev(()=>{
    const bak=JSON.stringify(db.invoices);
    const t=today(),y=+t.slice(0,4),morgen=addDays(t,1);
    const R=(id,d,p)=>({id,number:id,customerId:'',date:d,deliveryDate:d,klein:true,positions:[{qty:1,price:p}],payments:[]});
    db.invoices=[R('v1',(y-1)+'-01-01',100),R('v3',y+'-01-01',150)];
    /* nach dem heutigen Tag im Vorjahr: darf nicht mitzählen */
    if(morgen.slice(0,4)===String(y))db.invoices.push(R('v2',(y-1)+'-'+morgen.slice(5),900));
    const v=awVergleich(y);db.invoices=JSON.parse(bak);
    return {lauf:v.lauf,vor:v.vor,pj:v.pj};
  });
  assert.deepEqual(r,{lauf:150,vor:100,pj:50});
});

/* ---------- 5.6: E-Rechnung empfangen ---------- */
const UBL=`<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
<cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0</cbc:CustomizationID>
<cbc:ID>BW-2026-4711</cbc:ID><cbc:IssueDate>2026-11-02</cbc:IssueDate><cbc:DueDate>2026-11-16</cbc:DueDate><cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
<cac:AccountingSupplierParty><cac:Party><cac:PartyName><cbc:Name>Baywa</cbc:Name></cac:PartyName><cac:PartyTaxScheme><cbc:CompanyID>DE123456789</cbc:CompanyID></cac:PartyTaxScheme><cac:PartyLegalEntity><cbc:RegistrationName>BayWa AG</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingSupplierParty>
<cac:PaymentMeans><cbc:PaymentMeansCode>58</cbc:PaymentMeansCode><cac:PayeeFinancialAccount><cbc:ID>DE02120300000000202051</cbc:ID></cac:PayeeFinancialAccount></cac:PaymentMeans>
<cac:TaxTotal><cbc:TaxAmount currencyID="EUR">19.00</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount currencyID="EUR">100.00</cbc:TaxableAmount><cbc:TaxAmount currencyID="EUR">19.00</cbc:TaxAmount><cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>19</cbc:Percent></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>
<cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="EUR">100.00</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount currencyID="EUR">100.00</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="EUR">119.00</cbc:TaxInclusiveAmount><cbc:PayableAmount currencyID="EUR">119.00</cbc:PayableAmount></cac:LegalMonetaryTotal>
<cac:InvoiceLine><cbc:ID>1</cbc:ID><cbc:InvoicedQuantity unitCode="H87">20</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="EUR">60.00</cbc:LineExtensionAmount><cac:Item><cbc:Name>Rindenmulch 60 l</cbc:Name></cac:Item></cac:InvoiceLine>
<cac:InvoiceLine><cbc:ID>2</cbc:ID><cbc:InvoicedQuantity unitCode="H87">2</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="EUR">40.00</cbc:LineExtensionAmount><cac:Item><cbc:Name>Unkrautvlies</cbc:Name></cac:Item></cac:InvoiceLine>
</Invoice>`;
const CII=`<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
<rsm:ExchangedDocumentContext><ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext>
<rsm:ExchangedDocument><ram:ID>R-88</ram:ID><ram:TypeCode>380</ram:TypeCode><ram:IssueDateTime><udt:DateTimeString format="102">20261105</udt:DateTimeString></ram:IssueDateTime></rsm:ExchangedDocument>
<rsm:SupplyChainTradeTransaction>
<ram:IncludedSupplyChainTradeLineItem><ram:SpecifiedTradeProduct><ram:Name>Kettenöl 5 l</ram:Name></ram:SpecifiedTradeProduct><ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="H87">1</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery><ram:SpecifiedLineTradeSettlement><ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>30.00</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation></ram:SpecifiedLineTradeSettlement></ram:IncludedSupplyChainTradeLineItem>
<ram:IncludedSupplyChainTradeLineItem><ram:SpecifiedTradeProduct><ram:Name>Pflanzerde</ram:Name></ram:SpecifiedTradeProduct><ram:SpecifiedLineTradeSettlement><ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>20.00</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation></ram:SpecifiedLineTradeSettlement></ram:IncludedSupplyChainTradeLineItem>
<ram:ApplicableHeaderTradeAgreement><ram:SellerTradeParty><ram:Name>Stihl Shop Meier</ram:Name><ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">DE999999999</ram:ID></ram:SpecifiedTaxRegistration></ram:SellerTradeParty></ram:ApplicableHeaderTradeAgreement>
<ram:ApplicableHeaderTradeSettlement><ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
<ram:ApplicableTradeTax><ram:CalculatedAmount>5.70</ram:CalculatedAmount><ram:BasisAmount>30.00</ram:BasisAmount><ram:RateApplicablePercent>19</ram:RateApplicablePercent></ram:ApplicableTradeTax>
<ram:ApplicableTradeTax><ram:CalculatedAmount>1.40</ram:CalculatedAmount><ram:BasisAmount>20.00</ram:BasisAmount><ram:RateApplicablePercent>7</ram:RateApplicablePercent></ram:ApplicableTradeTax>
<ram:SpecifiedTradePaymentTerms><ram:DueDateDateTime><udt:DateTimeString format="102">20261119</udt:DateTimeString></ram:DueDateDateTime></ram:SpecifiedTradePaymentTerms>
<ram:SpecifiedTradeSettlementHeaderMonetarySummation><ram:LineTotalAmount>50.00</ram:LineTotalAmount><ram:TaxBasisTotalAmount>50.00</ram:TaxBasisTotalAmount><ram:TaxTotalAmount currencyID="EUR">7.10</ram:TaxTotalAmount><ram:GrandTotalAmount>57.10</ram:GrandTotalAmount><ram:DuePayableAmount>57.10</ram:DuePayableAmount></ram:SpecifiedTradeSettlementHeaderMonetarySummation>
</ram:ApplicableHeaderTradeSettlement></rsm:SupplyChainTradeTransaction></rsm:CrossIndustryInvoice>`;

test('E-Rechnung: XRechnung UBL und CII werden gelesen',async()=>{
  const r=await ev(([u,c])=>{
    const a=erParse(u),b=erParse(c);
    let fehler='';try{erParse('<html><body>kein</body></html>');}catch(e){fehler=e.message;}
    return {a:[a.format,a.nr,a.datum,a.faellig,a.lieferant,a.ustId,a.iban,a.netto,a.ust,a.brutto,a.zeilen.length,a.zeilen[0].name],
      b:[b.format,b.nr,b.datum,b.faellig,b.lieferant,b.ustId,b.brutto,b.saetze.length],
      pb:erPreset(b,c,'r.xml'),hb:erHinweise(b),fehler};
  },[UBL,CII]);
  assert.deepEqual(r.a,['XRechnung (UBL)','BW-2026-4711','2026-11-02','2026-11-16','BayWa AG','DE123456789','DE02120300000000202051',100,19,119,2,'Rindenmulch 60 l']);
  assert.deepEqual(r.b,['ZUGFeRD / Factur-X (CII)','R-88','2026-11-05','2026-11-19','Stihl Shop Meier','DE999999999',57.1,2]);
  assert.equal(r.pb.amount,57.1);
  assert.equal(r.pb.vat,19,'größte Steuerbasis gewinnt');
  assert.match(r.pb.desc,/Kettenöl 5 l u\. a\. \(2 Positionen\)/);
  assert.ok(r.hb.some(h=>/Mehrere Steuersätze/.test(h)));
  assert.match(r.fehler,/Unbekanntes Format/);
});

test('E-Rechnung: XML-Datei einlesen, Ausgabe sichern, Original bleibt erhalten',async()=>{
  const r=await ev(async u=>{
    const bak=JSON.stringify(db.expenses);
    await erEinlesen(new File([u],'baywa.xml',{type:'application/xml'}));
    const sh=[...document.querySelectorAll('.sheet')].pop();
    const felder={desc:sh.querySelector('#e_desc').value,amount:sh.querySelector('#e_amount').value,vendor:sh.querySelector('#e_vendor').value,
      date:sh.querySelector('#e_date').value,vat:sh.querySelector('#e_vat').value,karte:!!sh.querySelector('#e_er')};
    sh.querySelector('#e_save').click();
    const e=db.expenses[db.expenses.length-1];
    const gesp={xml:e.eRech&&e.eRech.xml===u,nr:e.eRech&&e.eRech.nr,amount:e.amount};
    /* zweites Mal: Doppel-Hinweis */
    await erEinlesen(new File([u],'baywa.xml',{type:'application/xml'}));
    const doppelt=((document.getElementById('e_erh')||{}).textContent||'');
    closeSheets();
    db.expenses=JSON.parse(bak);
    return {felder,gesp,doppelt};
  },UBL);
  assert.deepEqual(r.felder,{desc:'Rindenmulch 60 l u. a. (2 Positionen)',amount:'119',vendor:'BayWa AG',date:'2026-11-02',vat:'19',karte:true});
  assert.deepEqual(r.gesp,{xml:true,nr:'BW-2026-4711',amount:119});
  assert.match(r.doppelt,/schon eingelesen/);
});

test('E-Rechnung: ZUGFeRD-PDF mit komprimierter XML wird erkannt',async()=>{
  const r=await ev(async c=>{
    const z=new Uint8Array(await new Response(new Blob([new TextEncoder().encode(c)]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
    const kopf='%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n5 0 obj\n<< /Type /EmbeddedFile /Subtype /text#2Fxml /Filter /FlateDecode /Length '+z.length+' >>\nstream\n';
    const fuss='\nendstream\nendobj\n6 0 obj\n<< /Type /Filespec /F (factur-x.xml) /EF << /F 5 0 R >> >>\nendobj\n%%EOF';
    const enc=s=>Uint8Array.from(s,ch=>ch.charCodeAt(0));
    const pdf=new Blob([enc(kopf),z,enc(fuss)]);
    const xml=await erPdfXml(await pdf.arrayBuffer());
    const ohne=await erPdfXml(await new Blob([enc('%PDF-1.4\n1 0 obj\n<< >>\nendobj\n%%EOF')]).arrayBuffer());
    return {gleich:xml===c,ohne};
  },CII);
  assert.deepEqual(r,{gleich:true,ohne:null});
});

/* ---------- 5.7: Layout wie Vorschau ---------- */
test('Heute: Kennzahlen-Band, kompakter Einsatz, Braucht dich; Rechnungen: Summenband und Status',async()=>{
  const r=await ev(()=>{
    const bak=JSON.stringify({c:db.customers,i:db.invoices,j:db.jobs});const t=today();
    db.customers.push({id:'l1',name:'Schmidt',first:'Karl',last:'Schmidt'});
    db.invoices.push({id:'l2',number:'RE-L2',customerId:'l1',date:addDays(t,-20),dueDate:addDays(t,-6),klein:true,positions:[{desc:'Heckenschnitt',qty:1,price:220}],payments:[]});
    db.jobs.push({id:'l3',customerId:'l1',titel:'Laub',date:t,time:'09:00',status:'geplant',preis:90,werkzeug:[],material:[],fotos:[]});
    const h=vHeute();fInv='alle';yInv='alle';const re=vInvoices();
    const b=JSON.parse(bak);db.customers=b.c;db.invoices=b.i;db.jobs=b.j;
    const d=document.createElement('div');d.innerHTML=h;const e=document.createElement('div');e.innerHTML=re;
    return {band:!!d.querySelector('.kzband .kz'),einsatz:(d.querySelector('#n57 .bt')||{}).textContent||'',
      reihe:h.indexOf('n57')<h.indexOf('Braucht dich')&&h.indexOf('Braucht dich')<h.indexOf('class="wp"'),
      reband:(e.querySelector('#reband')||{}).textContent||'',karte:[...e.querySelectorAll('.rec')].map(x=>x.textContent.replace(/\s+/g,' ').trim()).find(x=>x.includes('RE-L2'))||''};
  });
  assert.ok(r.band);
  assert.match(r.einsatz,/Losfahren/);assert.match(r.einsatz,/Route/);
  assert.ok(r.reihe,'Einsatz, dann Braucht dich, dann Wochenplan');
  assert.match(r.reband,/Überfällig/);
  assert.match(r.karte,/Schmidt/);assert.match(r.karte,/220,00 €/);assert.match(r.karte,/Überfällig/);
});

test('Keine JavaScript-Fehler im ganzen Testlauf',()=>{assert.deepEqual(errors,[]);});

/* ---------- 5.8: Freie, mehrzeilige Anschrift ---------- */
test('Freie Anschrift: Kunde, Beleg-Überschreibung, Entwurf mit altem empf, Festschreiben',async()=>{
  const r=await ev(async()=>{
    const bak=JSON.stringify({c:db.customers,i:db.invoices});
    const frei='WEG Rathsbergerstraße 15a\nvertr. d. CC Bau-Consulting GmbH\nErlenstegenstraße 54\n90491 Nürnberg\nDeutschland';
    db.customers=[{id:'k1',company:'WEG Rathsbergerstraße 15a',street:'Rathsbergerstraße 15a',zip:'91054',city:'Erlangen',country:'Deutschland'},
                  {id:'k2',first:'Anna',last:'Meier',street:'Weg 1',zip:'91085',city:'Weisendorf'}];
    const out={};
    out.std=addrLines(db.customers[1]);
    db.customers[0].anschrift=frei;
    out.kunde=addrLines(db.customers[0]);
    /* Entwurf, kopiert aus festgeschriebener Rechnung: altes empf darf nicht gewinnen */
    const d={id:'p2',number:'RE-99003',customerId:'k2',date:'2026-11-26',deliveryDate:'2026-11-26',dueDate:'2026-12-03',
      klein:true,vat:19,positions:[{desc:'Heckenschnitt',unit:'Std.',qty:1,price:40}],payments:[],draft:true,empf:['Alt']};
    db.invoices=[d];
    out.entwurf=empfOf(d);
    d.empfFrei=frei;
    out.beleg=empfOf(d);
    out.check=reCheckList(d).E.filter(x=>/Anschrift (des Kunden|unvollständig: mind)|Freie Anschrift/.test(x));
    d.empfFrei='WEG\n90491 Nürnberg';
    out.checkKurz=reCheckList(d).E.filter(x=>/Anschrift (des Kunden|unvollständig: mind)|Freie Anschrift/.test(x)).length;
    d.empfFrei=frei;
    const Orig=window.jspdf.jsPDF,texte=[];
    window.jspdf.jsPDF=function(...a){const doc=new Orig(...a),t=doc.text;
      doc.text=function(x,...r){texte.push(String(x));return t.call(this,x,...r);};return doc;};
    try{await genPdf('invoice','p2','Rechnung');}catch(e){out.err=String(e.message||e);}
    window.jspdf.jsPDF=Orig;
    out.pdf=['vertr. d. CC Bau-Consulting GmbH','Erlenstegenstraße 54','90491 Nürnberg'].every(z=>texte.includes(z));
    /* Festgeschrieben: eingefroren in d.empf */
    out.fest=docEmpf(d);d.draft=false;d.empf=docEmpf(d);d.empfFrei='';
    out.eingefroren=empfOf(d);
    const o=JSON.parse(bak);db.customers=o.c;db.invoices=o.i;
    return out;
  });
  assert.deepEqual(r.std,['Anna Meier','Weg 1','91085 Weisendorf']);
  assert.equal(r.kunde.length,5);assert.equal(r.kunde[1],'vertr. d. CC Bau-Consulting GmbH');
  assert.deepEqual(r.entwurf,['Anna Meier','Weg 1','91085 Weisendorf']);
  assert.equal(r.beleg[0],'WEG Rathsbergerstraße 15a');assert.equal(r.beleg.length,5);
  assert.deepEqual(r.check,[]);
  assert.equal(r.checkKurz,1);
  assert.equal(r.err,undefined);
  assert.equal(r.pdf,true);
  assert.equal(r.eingefroren[1],'vertr. d. CC Bau-Consulting GmbH');
});

test('Kopie einer Rechnung übernimmt kein eingefrorenes empf und kein Archiv',async()=>{
  const n=await ev(()=>freshFromDoc({id:'x',empf:['A'],arch:{hash:'h'},finTs:1,positions:[]}));
  assert.equal(n.empf,undefined);assert.equal(n.arch,undefined);assert.equal(n.finTs,undefined);
});
