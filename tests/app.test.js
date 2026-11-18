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
