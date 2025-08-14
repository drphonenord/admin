
// Helpers
const $ = (s,root=document)=>root.querySelector(s);
const $$ = (s,root=document)=>Array.from(root.querySelectorAll(s));

// Header shadow
addEventListener('scroll', ()=>{
  const h = $('header');
  if(!h) return;
  h.style.boxShadow = scrollY > 8 ? '0 10px 30px rgba(0,0,0,.4)' : 'none';
});

// Call-me form (mock toast)
$('#callme')?.addEventListener('submit', (e)=>{
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  alert(`Merci ${data.name}. On te rappelle vite au ${data.phone}.`);
  e.target.reset();
});

// ---- Booking logic ----
async function fetchSlots(date){
  const r = await fetch(`/api/slots?date=${date}`);
  if(!r.ok) throw new Error('Erreur chargement créneaux');
  return r.json();
}
function todayISO(){
  const d = new Date(); d.setHours(0,0,0,0);
  return d.toISOString().slice(0,10);
}
function formatDateLabel(d){ // yyyy-mm-dd -> ven. 15/08
  const dt = new Date(d+'T00:00:00');
  const wd = ['dim.','lun.','mar.','mer.','jeu.','ven.','sam.'][dt.getDay()];
  const dd = String(dt.getDate()).padStart(2,'0');
  const mm = String(dt.getMonth()+1).padStart(2,'0');
  return `${wd} ${dd}/${mm}`;
}

async function initBooking(){
  const form = $('#booking');
  if(!form) return;
  const dateInput = form.querySelector('input[name="date"]');
  const slotSelect = form.querySelector('select[name="slot"]');
  const date = todayISO();
  dateInput.value = date;
  await loadSlots(date);
  dateInput.addEventListener('change', (e)=> loadSlots(e.target.value));

  async function loadSlots(d){
    slotSelect.innerHTML = '<option value="">Chargement…</option>';
    const data = await fetchSlots(d);
    slotSelect.innerHTML = '<option value="">Choisir…</option>';
    data.slots.forEach(s=>{
      const opt = document.createElement('option');
      opt.value = s.time;
      opt.textContent = `${formatDateLabel(d)} - ${s.time} ${s.full ? '(complet)' : ''}`;
      if(s.full) { opt.disabled = true; }
      slotSelect.appendChild(opt);
    });
  }

  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const fd = new FormData(form);
    const payload = {
      first: fd.get('first'), last: fd.get('last'), tel: fd.get('tel'),
      email: fd.get('email')||'', city: fd.get('city'), model: fd.get('model'),
      date: fd.get('date'), time: fd.get('slot'), issue: fd.get('issue')
    };
    const r = await fetch('/api/rdv', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    const j = await r.json();
    if(!r.ok){ alert(j.error || 'Impossible de réserver'); return; }
    alert('RDV confirmé ✅');
    form.reset();
    await loadSlots(payload.date);
  });
}
document.addEventListener('DOMContentLoaded', initBooking);

// ---- Diagnostic page: pre-fill from URL ----
function prefillDiagnostic(){
  const diagForm = $('#diag-form');
  if(!diagForm) return;
  const url = new URL(location.href);
  const marque = url.searchParams.get('marque');
  const modele = url.searchParams.get('modele');
  const prob = url.searchParams.get('probleme');
  if(marque) diagForm.querySelector('[name="brand"]').value = marque;
  if(modele) diagForm.querySelector('[name="model"]').value = modele;
  if(prob) diagForm.querySelector('[name="issue"]').value = prob;
  // Update share link
  const share = $('#share-link');
  function updateShare(){
    const params = new URLSearchParams({
      marque: diagForm.brand.value, modele: diagForm.model.value, probleme: diagForm.issue.value
    });
    share.value = `${location.origin}${location.pathname}?${params.toString()}`;
  }
  ['brand','model','issue'].forEach(n=> diagForm[n].addEventListener('input', updateShare));
  updateShare();
}
document.addEventListener('DOMContentLoaded', prefillDiagnostic);

// PWA
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('/service-worker.js').catch(()=>{});
}
