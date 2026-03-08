/* Homatt Health — Clinic Portal shared JS */

function requireClinic() {
  let s;
  try { s = JSON.parse(localStorage.getItem('clinic_session') || 'null'); } catch(e) {}
  if (!s || typeof s !== 'object' || Array.isArray(s)) {
    localStorage.removeItem('clinic_session');
    window.location.href = 'index.html';
    return null;
  }
  const name = s.staffName || s.name || 'Clinic Staff';
  const el1 = document.getElementById('clinicUserName');
  const el2 = document.getElementById('clinicUserNameTop');
  const av  = document.getElementById('clinicUserAvatar');
  if (el1) el1.textContent = name;
  if (el2) el2.textContent = name;
  if (av)  av.textContent  = name[0].toUpperCase();
  return s;
}

function setupClinicLogout() {
  document.getElementById('clinicLogoutBtn')?.addEventListener('click', () => {
    localStorage.removeItem('clinic_session');
    window.location.href = 'index.html';
  });
}

function showToast(msg, type = 'success') {
  let t = document.getElementById('clinicToast');
  if (!t) { t = document.createElement('div'); t.id = 'clinicToast'; t.className = 'admin-toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.style.background = type === 'error' ? '#D32F2F' : '#1E1E1E';
  t.classList.add('visible');
  setTimeout(() => t.classList.remove('visible'), 3000);
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-UG', { day:'numeric', month:'short', year:'numeric' });
}
function fmtTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleTimeString('en-UG', { hour:'2-digit', minute:'2-digit' });
}

/* ── Mock patient data ── */
const MOCK_PATIENTS = [
  { q:1, id:'P-001', name:'Ssempa Robert',    age:55, sex:'M', complaint:'High blood pressure / dizziness', priority:'urgent',    status:'waiting',     arrive:'08:15' },
  { q:2, id:'P-002', name:'Nakato Brenda',    age:28, sex:'F', complaint:'Fever & headache',                priority:'normal',    status:'in-progress', arrive:'08:40' },
  { q:3, id:'P-003', name:'Mubiru John',      age:12, sex:'M', complaint:'Malaria symptoms',               priority:'high',      status:'waiting',     arrive:'09:05' },
  { q:4, id:'P-004', name:'Namutebi Agnes',   age:31, sex:'F', complaint:'Prenatal check-up (32 weeks)',   priority:'scheduled', status:'waiting',     arrive:'09:20' },
  { q:5, id:'P-005', name:'Kibuuka Paul',     age:67, sex:'M', complaint:'Chest pain & shortness of breath', priority:'urgent',  status:'waiting',     arrive:'09:35' },
  { q:6, id:'P-006', name:'Namukasa Grace',   age:24, sex:'F', complaint:'Stomach pain',                  priority:'normal',    status:'waiting',     arrive:'09:50' },
  { q:7, id:'P-007', name:'Ssali Emmanuel',   age:44, sex:'M', complaint:'Diabetes check + insulin Rx',   priority:'scheduled', status:'waiting',     arrive:'10:05' },
];

const MOCK_APPOINTMENTS = [
  { time:'10:30', name:'Dr. check – Nakayiza Rose',     type:'Ante-natal follow-up' },
  { time:'11:00', name:'Tumwesigye Alex',               type:'Post-surgery wound check' },
  { time:'11:30', name:'Nabirye Florence (child)',      type:'Immunisation' },
  { time:'13:00', name:'Ssekandi Mark',                 type:'Lab results review' },
  { time:'14:00', name:'Nambi Sarah',                   type:'BP monitoring' },
  { time:'14:30', name:'Okello Dennis',                 type:'Malaria follow-up' },
];
