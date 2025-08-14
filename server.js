const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');
const cfg = require('./config');

// --- Mail helper ---
function mailTransport(){
  if(process.env.SMTP_URL){ return nodemailer.createTransport(process.env.SMTP_URL); }
  if(process.env.EMAIL_USER && process.env.EMAIL_PASS){
    return nodemailer.createTransport({ service:'gmail', auth:{ user:process.env.EMAIL_USER, pass:process.env.EMAIL_PASS } });
  }
  return nodemailer.createTransport({ sendmail:true, newline:'unix', path:'/usr/sbin/sendmail' });
}
async function sendMailSafe(opts){
  try{ const t = mailTransport(); await t.sendMail(opts); return true; }
  catch(e){ console.warn('Email non envoyé:', e.message); return false; }
}


const app = express();
const PORT = process.env.PORT || 5000;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'drphone-secret',
  resave: false,
  saveUninitialized: false,
}));

// CORS for API (optional, local dev)
app.use((req,res,next)=>{
  res.setHeader('X-Frame-Options','SAMEORIGIN');
  next();
});

// Serve static
app.use(express.static(path.join(__dirname, 'public')));

// Helpers
const dataFile = path.join(__dirname, 'data', 'rdv.json');
function loadData(){
  try{ return JSON.parse(fs.readFileSync(dataFile, 'utf-8')); }catch(e){ return { rdv: [] }; }
}
function saveData(data){
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2), 'utf-8');
}
function parseTime(t){ const [H,M]=t.split(':').map(Number); return H*60+M; }
function pad(n){ return n.toString().padStart(2,'0'); }
function minutesToStr(m){ const H = Math.floor(m/60), M = m%60; return `${pad(H)}:${pad(M)}`; }
function ensureQuotes(data){ if(!data.quotes) data.quotes = []; return data; }
function getSlotsForDate(dateStr){
  const d = new Date(dateStr + 'T00:00:00');
  const dow = d.getDay();
  const hours = cfg.hours[dow];
  if(!hours) return [];
  const start = parseTime(hours.start);
  const end = parseTime(hours.end);
  const step = cfg.slotMinutes;
  const slots = [];
  for(let m=start; m<end; m+=step){
    slots.push(minutesToStr(m));
  }
  return slots;
}

// API: get slots with counts for a given date
app.get('/api/slots', (req,res)=>{
  const { date } = req.query;
  if(!date) return res.status(400).json({ error: 'date (YYYY-MM-DD) requis' });
  const slots = getSlotsForDate(date);
  const data = loadData();
  const counts = {};
  data.rdv.filter(x=>x.date===date).forEach(x=>{
    counts[x.time] = (counts[x.time]||0) + 1;
  });
  const out = slots.map(time => ({ time, count: counts[time]||0, full: (counts[time]||0) >= cfg.maxPerSlot }));
  res.json({ date, slots: out, maxPerSlot: cfg.maxPerSlot, slotMinutes: cfg.slotMinutes });
});

// API: create booking
app.post('/api/rdv', async (req,res)=>{
  const { first, last, tel, email, city, model, date, time, issue } = req.body;
  if(!first || !last || !tel || !city || !model || !date || !time || !issue){
    return res.status(400).json({ error: 'Champs requis manquants' });
  }
  // Check slot validity & capacity
  const validSlots = getSlotsForDate(date);
  if(!validSlots.includes(time)){
    return res.status(400).json({ error: 'Créneau hors horaires' });
  }
  const data = loadData();
  const count = data.rdv.filter(x=>x.date===date && x.time===time).length;
  if(count >= cfg.maxPerSlot){
    return res.status(409).json({ error: 'Créneau complet' });
  }
  const id = uuidv4();
  const item = { id, first, last, tel, email: email||'', city, model, date, time, issue, createdAt: new Date().toISOString(), viewed: false };
  const db = loadData();
  item.number = db.nextNumber || 1001;
  db.nextNumber = (db.nextNumber||1001) + 1;
  db.rdv.push(item);
  saveData(db);
  await sendMailSafe({
    from: process.env.MAIL_FROM || 'noreply@drphone.local',
    to: process.env.NOTIFY_TO || 'drphonenord@gmail.com',
    subject: `Nouveau RDV — ${first} ${last} (${model})`,
    text: `Nom: ${first} ${last}\nTel: ${tel}\nEmail: ${email||'-'}\nVille: ${city}\nModèle: ${model}\nDate/Heure: ${date} ${time}\nPanne: ${issue}\nID: ${id}\n`
  });
  return res.json({ ok: true, id, number: item.number });
  // handled above
});


// API: Demande de devis (quote)
app.post('/api/quote', async (req,res)=>{
  const { first, last, tel, email, city, model, issue } = req.body || {};
  if(!first || !last || !tel || !model || !issue){
    return res.status(400).json({ error: 'Champs obligatoires: prénom, nom, téléphone, modèle, description' });
  }
  const id = uuidv4();
  const db = loadData(); ensureQuotes(db);
  const item = { id, first, last, tel, email: email||'', city: city||'', model, issue, createdAt: new Date().toISOString(), type:'quote', viewed:false };
  db.quotes.push(item); saveData(db);

  const to = process.env.NOTIFY_TO || 'drphonenord@gmail.com';
  await sendMailSafe({
    from: process.env.MAIL_FROM || 'noreply@drphone.local',
    to,
    subject: `Demande de devis — ${first} ${last} (${model})`,
    text: `Nom: ${first} ${last}\nTel: ${tel}\nEmail: ${email||'-'}\nVille: ${city||'-'}\nModèle: ${model}\nPanne: ${issue}\nID: ${id}\n`
  });
  res.json({ ok:true, id });
});

// --- Admin ---
// Admin create dossier
app.post('/admin/create', requireAdmin, async (req,res)=>{
  const { first,last,tel,email,city,model,date,time,issue, imei, intake, passcode, accessories,
    powerOn, sim, microsd, faceid, touchid, trueTone, photosMade, payAmount, payMethod, payPaid } = req.body;
  const id = uuidv4();
  const db = loadData();
  const item = {
    id, first, last, tel, email: email||'', city, model, date: date||'', time: time||'',
    issue: issue||'', imei: imei||'', intake: intake||'', passcode: passcode||'', accessories: accessories||'',
    checks: {
      powerOn: !!powerOn, sim: !!sim, microsd: !!microsd, faceid: !!faceid, touchid: !!touchid, trueTone: !!trueTone, photosMade: !!photosMade
    },
    payment: { amount: payAmount||'', method: payMethod||'', paid: !!payPaid },
    createdAt: new Date().toISOString()
  };
  item.number = db.nextNumber || 1001;
  db.nextNumber = (db.nextNumber||1001) + 1;
  db.rdv.push(item);
  saveData(db);
  res.redirect('/admin/');
});

function requireAdmin(req,res,next){
  if(req.session && req.session.admin) return next();
  return res.redirect('/admin/login.html');
}
app.post('/admin/login', (req,res)=>{
  const { password } = req.body;
  if(password === cfg.adminPassword){
    req.session.admin = true;
    return res.redirect('/admin/');
  }
  res.redirect('/admin/login.html?e=1');
});

app.get('/admin/logout', (req,res)=>{
  req.session.destroy(()=> res.redirect('/'));
});

app.get('/admin/data', requireAdmin, (req,res)=>{
  res.json(loadData());
});

app.post('/admin/delete', requireAdmin, (req,res)=>{
  const { id } = req.body;
  const data = loadData();
  const n = data.rdv.length;
  const next = { rdv: data.rdv.filter(x=>x.id !== id) };
  saveData(next);
  res.json({ ok: true, deleted: n - next.rdv.length });
});

// Update RDV (IMEI + intake)
app.post('/admin/update', requireAdmin, (req,res)=>{
  const { id, imei, intake } = req.body;
  if(!id){ return res.status(400).json({ error: 'id requis' }); }
  const data = loadData();
  const item = data.rdv.find(x=>x.id===id);
  if(!item){ return res.status(404).json({ error: 'RDV introuvable' }); }
  item.imei = imei || '';
  item.intake = intake || '';
  saveData(data);
  res.redirect('/admin/');
});

// JSON update (autosave)
app.post('/admin/update.json', requireAdmin, async (req,res)=>{
  const { id } = req.body;
  if(!id) return res.status(400).json({ error: 'id requis' });
  const data = loadData();
  const item = data.rdv.find(x=>x.id===id);
  if(!item) return res.status(404).json({ error: 'RDV introuvable' });

  // Allowed fields
  const f = req.body;
  item.first = f.first || item.first;
  item.last = f.last || item.last;
  item.tel = f.tel || item.tel;
  item.email = f.email || item.email;
  item.city = f.city || item.city;
  item.model = f.model || item.model;
  item.date = f.date || item.date;
  item.time = f.time || item.time;
  item.issue = f.issue || item.issue;
  item.imei = f.imei || '';
  item.intake = f.intake || '';
  item.passcode = f.passcode || '';
  item.accessories = f.accessories || '';
  item.status = f.status || item.status || 'À faire';
  item.checks = item.checks || {};
  item.checks.powerOn = f.powerOn === 'true' || f.powerOn === true;
  item.checks.sim = f.sim === 'true' || f.sim === true;
  item.checks.microsd = f.microsd === 'true' || f.microsd === true;
  item.checks.faceid = f.faceid === 'true' || f.faceid === true;
  item.checks.touchid = f.touchid === 'true' || f.touchid === true;
  item.checks.trueTone = f.trueTone === 'true' || f.trueTone === true;
  item.checks.photosMade = f.photosMade === 'true' || f.photosMade === true;
  item.payment = item.payment || {};
  item.payment.amount = f.payAmount || item.payment.amount || '';
  item.payment.method = f.payMethod || item.payment.method || '';
  item.payment.paid = f.payPaid === 'true' || f.payPaid === true || item.payment.paid === true;

  saveData(data);
  res.json({ ok:true, id, savedAt: new Date().toISOString() });
});

// Mark item as viewed (RDV or quote)
app.post('/admin/mark-viewed', requireAdmin, (req,res)=>{
  const { id, kind } = req.body || {};
  if(!id) return res.status(400).json({ error:'id requis' });
  const db = loadData();
  let ok = false;
  if(kind==='quote' && db.quotes){
    const it = db.quotes.find(x=>x.id===id); if(it){ it.viewed = true; ok = true; }
  } else {
    const it = db.rdv.find(x=>x.id===id); if(it){ it.viewed = true; ok = true; }
  }
  if(ok){ saveData(db); return res.json({ ok:true }); }
  return res.status(404).json({ error:'introuvable' });
});

// Export CSV - quotes
app.get('/admin/quotes.csv', requireAdmin, (req,res)=>{
  const db = loadData(); const rows = (db.quotes||[]).slice().sort((a,b)=> (b.createdAt||'').localeCompare(a.createdAt||''));
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition','attachment; filename="devis.csv"');
  const esc = s => (''+(s||'')).replace(/"/g,'""');
  const head = ['Date','Prénom','Nom','Téléphone','Email','Ville','Modèle','Description','ID','Lu'];
  const out = [head.join(';')].concat(rows.map(x=>[
    x.createdAt||'', esc(x.first), esc(x.last), esc(x.tel), esc(x.email), esc(x.city), esc(x.model), esc(x.issue), x.id, x.viewed?'oui':'non'
  ].join(';'))).join('\n');
  res.send(out);
});

// Admin static
app.use('/admin', requireAdmin, express.static(path.join(__dirname, 'public/admin')));


const PDFDocument = require('pdfkit');

app.get('/admin/bon/:id.pdf', requireAdmin, (req,res)=>{
  const { id } = req.params;
  const data = loadData();
  const item = data.rdv.find(x=>x.id === id);
  if(!item){ return res.status(404).send('RDV introuvable'); }

  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="bon-intervention-${id}.pdf"`);

  const doc = new PDFDocument({ size:'A4', margin: 40 });
  doc.pipe(res);

  // Header with logo & company info
  try {
    doc.image(path.join(__dirname,'public','assets','logo.png'), 40, 30, { width: 80 });
  } catch(e){ /* ignore if not found */ }
  doc.fontSize(22).fillColor('#0a0d14').fillColor('#00a0b5').text('DR PHONE', 140, 36);
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor('#333').text(`${cfg.company.address}`);
  doc.text(`Tél : ${cfg.company.phone}  •  Email : ${cfg.company.email}`);
  doc.moveDown(1);

  // Title line
  doc.fillColor('#000').fontSize(16).fillColor('#00a0b5').text('Bon d’intervention & acceptation des conditions', { underline:false });
  doc.moveDown(0.5);
  doc.fillColor('#333').fontSize(10).text(`N° intervention : DRP-${item.number || '—'}`);
  doc.text(`ID dossier : ${id}`);
  doc.text(`Date : ${new Date().toLocaleString('fr-FR')}`);
  doc.moveDown(0.8);

  // Client & device block
  const boxTop = doc.y;
  doc.roundedRect(40, boxTop, 515, 110, 6).stroke('#00f5ff');
  doc.fontSize(11).fillColor('#0d0d0d').fillColor('#c3eafe');
  doc.text('Informations client', 52, boxTop+8);
  doc.fontSize(10).fillColor('#111').fillColor('#e2e8f0');
  doc.text(`Nom : ${item.first} ${item.last}`, 52, boxTop+28);
  doc.text(`Téléphone : ${item.tel}`, 300, boxTop+28);
  doc.text(`Email : ${item.email||'-'}`, 52, boxTop+48);
  doc.text(`Ville : ${item.city}`, 300, boxTop+48);
  doc.moveTo(40, boxTop+70).lineTo(555, boxTop+70).stroke('#1b2a38');
  doc.fontSize(11).fillColor('#c3eafe').text('Appareil & panne', 52, boxTop+76);
  doc.fontSize(10).fillColor('#e2e8f0').text(`Modèle : ${item.model}`, 52, boxTop+96);
  doc.text(`Créneau : ${item.date} ${item.time}`, 300, boxTop+96);
  doc.text(`Statut : ${item.status||'À faire'}`, 300, boxTop+116);
  doc.text(`IMEI / N° série : ${item.imei||'-'}`, 52, boxTop+116);
  doc.moveDown(8);
  doc.y = boxTop + 170;

  // CGV short summary
  doc.moveDown(1);
  doc.fillColor('#c3eafe').fontSize(12).text('Conditions essentielles (résumé)');
  doc.fillColor('#e2e8f0').fontSize(9);
  const bullets = [
    "J’autorise Dr Phone à intervenir sur mon appareil et j’atteste être propriétaire ou dûment autorisé.",
    "Je comprends que l’ouverture du téléphone peut affecter la garantie constructeur et que toute casse/oxydation antérieure ne peut être couverte.",
    "Les données sont sous ma responsabilité — Dr Phone s’engage à ne pas y accéder et à réaliser des tests devant moi.",
    "Garantie 6 mois sur pièces et main d’œuvre hors casse, choc, oxydation, défauts tiers ou usage non conforme.",
    "Paiement à la fin de l’intervention. Devis ferme communiqué avant réparation.",
    "Les conditions complètes (CGV) sont disponibles sur le site. En signant, j’accepte ces conditions."
  ];
  bullets.forEach((b,i)=>{
    doc.text(`• ${b}`, { paragraphGap: 4 });
  });
  doc.moveDown(1.2);

  // Accessoires confiés
  doc.fillColor('#c3eafe').fontSize(12).text('Accessoires confiés');
  doc.fillColor('#e2e8f0').fontSize(9).text(item.accessories ? item.accessories : 'Aucun indiqué');
  doc.moveDown(1);

  // Etat à la réception
  doc.fillColor('#c3eafe').fontSize(12).text('État à la réception');
  doc.fillColor('#e2e8f0').fontSize(9).text(item.intake ? item.intake : '____');
  doc.moveDown(1);

  // Checklist état rapide
  doc.fillColor('#c3eafe').fontSize(12).text('Checklist état rapide');
  const chk = item.checks || {};
  function cb(label, val){ doc.fillColor('#e2e8f0').fontSize(9).text(`${val?'[X]':'[ ]'} ${label}`); }
  cb('Appareil s’allume', chk.powerOn);
  cb('Carte SIM présente', chk.sim);
  cb('Carte microSD présente', chk.microsd);
  cb('Face ID OK', chk.faceid);
  cb('Touch ID OK', chk.touchid);
  cb('True Tone OK', chk.trueTone);
  cb('Photos d’état prises', chk.photosMade);
  doc.moveDown(1);

  // Paiement
  doc.fillColor('#c3eafe').fontSize(12).text('Paiement');
  const p = item.payment || {};
  doc.fillColor('#e2e8f0').fontSize(10).text(`Montant : ${p.amount||'-'}    •    Mode : ${p.method||'-'}    •    Payé : ${p.paid ? 'Oui' : 'Non'}`);
  doc.moveDown(0.8);

  // Signature area
  const sigTop = doc.y + 10;
  doc.fontSize(11).fillColor('#c3eafe').text('Signature client précédée de la mention “Bon pour accord” :', 40, sigTop);
  doc.rect(40, sigTop+20, 240, 70).stroke('#00f5ff');
  doc.fontSize(11).fillColor('#c3eafe').text('Signature technicien :', 320, sigTop);
  doc.rect(320, sigTop+20, 235, 70).stroke('#00f5ff');

  if((item.payment||{}).paid){
    doc.save();
    doc.rotate(-15, { origin: [300, 500] });
    doc.fontSize(72).fillColor('#00ff95').opacity(0.35).text('PAYÉ', 180, 460, { align: 'center' });
    doc.opacity(1).restore();
  }
  doc.end();
});

// Fallback to index.html for unknown routes
app.get('*', (req,res)=> res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, ()=> console.log(`✅ Dr Phone server running on http://localhost:${PORT}`));

// Health check for Render
app.get('/health', (req,res)=> res.json({ ok:true, time:new Date().toISOString() }));
