/* ============================================================
   AG PRIME — COUCHE FIREBASE
   ============================================================ */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getFirestore, collection, doc,
  getDocs, getDoc, addDoc, setDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, startAfter,
  onSnapshot, serverTimestamp, arrayUnion, arrayRemove
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  getStorage, ref as storageRef,
  uploadBytesResumable, getDownloadURL, deleteObject
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';

/* ============================================================
   1. CONFIGURATION
   ============================================================ */
const firebaseConfig = {
  apiKey:            "AIzaSyCwLvfgiEtQCDV8l8VuC2VQYtpFMPFesM8",
  authDomain:        "ag-prime-720f8.firebaseapp.com",
  projectId:         "ag-prime-720f8",
  storageBucket:     "ag-prime-720f8.firebasestorage.app",
  messagingSenderId: "605970765517",
  appId:             "1:605970765517:web:951d1be4c4176eb2d57b84"
};

const app     = initializeApp(firebaseConfig);
const db      = getFirestore(app);
const auth    = getAuth(app);
const storage = getStorage(app);

/* ============================================================
   2. AUTH
   ============================================================ */
export async function registerUser({ email, password, name }) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName: name });
  await setDoc(doc(db, 'users', cred.user.uid), {
    name, email, role: 'user',
    kycStatus: 'none', kycDocs: [], favoris: [],
    createdAt: serverTimestamp()
  });
  return { uid: cred.user.uid, name, email, role: 'user' };
}

export async function loginUser({ email, password }) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  const snap = await getDoc(doc(db, 'users', cred.user.uid));
  if (!snap.exists()) throw new Error('Profil introuvable');
  return { uid: cred.user.uid, ...snap.data() };
}

export async function logoutUser() {
  await signOut(auth);
}

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, async (user) => {
    if (!user) { callback(null); return; }
    const snap = await getDoc(doc(db, 'users', user.uid));
    callback(snap.exists() ? { uid: user.uid, ...snap.data() } : null);
  });
}

/* ============================================================
   3. ANNONCES — lecture paginée
   ============================================================ */
let lastAnnonceDoc = null;

export async function fetchAnnonces({ cat = null, reset = false } = {}) {
  if (reset) lastAnnonceDoc = null;
  const constraints = [
    where('status', '==', 'approved'),
    orderBy('createdAt', 'desc'),
    limit(20)
  ];
  if (cat) constraints.splice(1, 0, where('cat', '==', cat));
  if (lastAnnonceDoc) constraints.push(startAfter(lastAnnonceDoc));
  const snap = await getDocs(query(collection(db, 'annonces'), ...constraints));
  if (!snap.empty) lastAnnonceDoc = snap.docs[snap.docs.length - 1];
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function fetchFlashAnnonces() {
  const snap = await getDocs(query(
    collection(db, 'annonces'),
    where('status', '==', 'approved'),
    where('flashDiscount', '!=', null),
    orderBy('flashDiscount', 'desc'),
    limit(10)
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function searchAnnonces(terme) {
  const snap = await getDocs(query(
    collection(db, 'annonces'),
    where('status', '==', 'approved'),
    where('titre', '>=', terme),
    where('titre', '<=', terme + '\uf8ff'),
    limit(30)
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function fetchMesAnnonces(vendeurId) {
  const snap = await getDocs(query(
    collection(db, 'annonces'),
    where('vendeurId', '==', vendeurId),
    orderBy('createdAt', 'desc')
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function fetchAllAnnonces({ status = null } = {}) {
  let constraints = [orderBy('createdAt', 'desc')];
  if (status) constraints.unshift(where('status', '==', status));
  const snap = await getDocs(query(collection(db, 'annonces'), ...constraints));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getAnnonce(id) {
  const snap = await getDoc(doc(db, 'annonces', id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/* ============================================================
   4. ANNONCES — écriture
   ============================================================ */
export async function publierAnnonce(data, user) {
  const r = await addDoc(collection(db, 'annonces'), {
    ...data,
    vendeur: user.name, vendeurId: user.uid,
    status: 'pending', photos: [],
    createdAt: serverTimestamp()
  });
  return r.id;
}

export async function modifierAnnonce(id, data) {
  await updateDoc(doc(db, 'annonces', id), { ...data, updatedAt: serverTimestamp() });
}

export async function supprimerAnnonce(id) {
  await deleteDoc(doc(db, 'annonces', id));
}

export async function changerStatusAnnonce(id, status) {
  await updateDoc(doc(db, 'annonces', id), { status, updatedAt: serverTimestamp() });
}

/* ============================================================
   5. PHOTOS
   ============================================================ */
export async function uploadPhoto(annonceId, file, onProgress) {
  const path    = `annonces/${annonceId}/${Date.now()}_${file.name}`;
  const fileRef = storageRef(storage, path);
  const task    = uploadBytesResumable(fileRef, file);
  return new Promise((resolve, reject) => {
    task.on('state_changed',
      s => onProgress && onProgress(Math.round(s.bytesTransferred / s.totalBytes * 100)),
      reject,
      async () => {
        const url = await getDownloadURL(task.snapshot.ref);
        await updateDoc(doc(db, 'annonces', annonceId), { photos: arrayUnion(url) });
        resolve(url);
      }
    );
  });
}

export async function supprimerPhoto(annonceId, photoUrl) {
  await deleteObject(storageRef(storage, photoUrl));
  await updateDoc(doc(db, 'annonces', annonceId), { photos: arrayRemove(photoUrl) });
}

/* ============================================================
   6. FAVORIS
   ============================================================ */
export async function ajouterFavori(userId, annonceId) {
  await updateDoc(doc(db, 'users', userId), { favoris: arrayUnion(annonceId) });
}
export async function retirerFavori(userId, annonceId) {
  await updateDoc(doc(db, 'users', userId), { favoris: arrayRemove(annonceId) });
}
export async function fetchFavoris(userId) {
  const snap = await getDoc(doc(db, 'users', userId));
  if (!snap.exists()) return [];
  const ids = snap.data().favoris || [];
  if (!ids.length) return [];
  const results = [];
  for (let i = 0; i < ids.length; i += 10) {
    const chunk = ids.slice(i, i + 10);
    const s = await getDocs(query(collection(db, 'annonces'), where('__name__', 'in', chunk)));
    s.docs.forEach(d => results.push({ id: d.id, ...d.data() }));
  }
  return results;
}

/* ============================================================
   7. MESSAGERIE TEMPS RÉEL
   ============================================================ */
export async function fetchConversations(userId) {
  const snap = await getDocs(query(
    collection(db, 'conversations'),
    where('participants', 'array-contains', userId),
    orderBy('lastAt', 'desc')
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getOrCreateConversation(annonceId, myUser, vendeurId, vendeurName) {
  const snap = await getDocs(query(
    collection(db, 'conversations'),
    where('annonceId', '==', annonceId),
    where('participants', 'array-contains', myUser.uid)
  ));
  const existing = snap.docs.find(d => d.data().participants.includes(vendeurId));
  if (existing) return { id: existing.id, ...existing.data() };
  const r = await addDoc(collection(db, 'conversations'), {
    annonceId,
    participants:     [myUser.uid, vendeurId],
    participantNames: { [myUser.uid]: myUser.name, [vendeurId]: vendeurName },
    lastMessage: '', lastAt: serverTimestamp()
  });
  return { id: r.id };
}

export async function envoyerMessage(convId, auteurId, auteurName, texte) {
  await addDoc(collection(db, 'conversations', convId, 'messages'), {
    auteurId, auteurName, texte, sentAt: serverTimestamp(), lu: false
  });
  await updateDoc(doc(db, 'conversations', convId), {
    lastMessage: texte, lastAt: serverTimestamp()
  });
}

export function ecouterMessages(convId, callback) {
  return onSnapshot(
    query(collection(db, 'conversations', convId, 'messages'), orderBy('sentAt', 'asc')),
    snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  );
}

/* ============================================================
   8. KYC
   ============================================================ */
export async function soumettreKYC(userId, docs) {
  await updateDoc(doc(db, 'users', userId), {
    kycStatus: 'pending', kycDocs: docs, kycSentAt: serverTimestamp()
  });
}
export async function validerKYC(userId) {
  await updateDoc(doc(db, 'users', userId), {
    kycStatus: 'verified', kycValidatedAt: serverTimestamp()
  });
}
export async function refuserKYC(userId, raison) {
  await updateDoc(doc(db, 'users', userId), { kycStatus: 'rejected', kycRaison: raison });
}
export async function fetchKYCEnAttente() {
  const snap = await getDocs(
    query(collection(db, 'users'), where('kycStatus', '==', 'pending'))
  );
  return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
}

/* ============================================================
   9. ADMIN / OWNER
   ============================================================ */
export async function fetchAllUsers() {
  const snap = await getDocs(query(collection(db, 'users'), orderBy('createdAt', 'desc')));
  return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
}

export async function bannirUtilisateur(userId) {
  await updateDoc(doc(db, 'users', userId), { role: 'banned', bannedAt: serverTimestamp() });
  const snap = await getDocs(
    query(collection(db, 'annonces'), where('vendeurId', '==', userId))
  );
  await Promise.all(snap.docs.map(d =>
    updateDoc(doc(db, 'annonces', d.id), { status: 'banned' })
  ));
}

export async function changerRoleUtilisateur(userId, role) {
  await updateDoc(doc(db, 'users', userId), { role });
}

export async function fetchStatsOwner() {
  const [aSnap, uSnap] = await Promise.all([
    getDocs(collection(db, 'annonces')),
    getDocs(collection(db, 'users'))
  ]);
  const annonces = aSnap.docs.map(d => d.data());
  const users    = uSnap.docs.map(d => d.data());
  return {
    totalAnnonces:   annonces.length,
    annoncesActives: annonces.filter(a => a.status === 'approved').length,
    totalUsers:      users.length,
    usersBannis:     users.filter(u => u.role === 'banned').length,
    kycEnAttente:    users.filter(u => u.kycStatus === 'pending').length,
    commissionsUSD:  Math.round(
      annonces.filter(a => a.status === 'sold')
              .reduce((s, a) => s + (a.prixUSD || 0) * 0.01, 0)
    )
  };
}

/* ============================================================
   10. SEED — initialise les données de démo (une seule fois)
   Appelle depuis la console : await window.seedFirestore()
   ============================================================ */
window.seedFirestore = async function() {
  const seed = [
    { cat:'automobile', icon:'🚗', titre:'Toyota RAV4 2018',       prixUSD:28500,  vendeur:'Konan Kouamé',    vendeurId:'demo', localisation:'Abidjan, Cocody',  annee:'2018', km:'45,000 km', boite:'Auto', carb:'Essence', couleur:'Noire',   desc:'Excellent état, entretenu régulièrement. Aucun choc.', status:'approved', flashDiscount:null, photos:[] },
    { cat:'maison',     icon:'🏡', titre:'Maison moderne 4P',       prixUSD:84600,  vendeur:'Amani Touré',     vendeurId:'demo', localisation:'Abidjan, Cocody',  surface:'180m²', pieces:'4', annee:'2021', desc:'Belle villa moderne avec jardin et garage.', status:'approved', flashDiscount:null, photos:[] },
    { cat:'appart',     icon:'🏢', titre:'Appartement F3 Centre',   prixUSD:27700,  vendeur:'Bamba Souleymane',vendeurId:'demo', localisation:'Abidjan, Plateau', surface:'85m²',  pieces:'3', annee:'2022', desc:'Appart refait à neuf, résidence sécurisée 24h/24.', status:'approved', flashDiscount:null, photos:[] },
    { cat:'terrain',    icon:'🌿', titre:'Terrain 500m² Bingerville',prixUSD:13100, vendeur:'Diallo Moussa',   vendeurId:'demo', localisation:'Bingerville',      surface:'500m²', annee:'2023', desc:'Terrain viabilisé avec titre foncier.', status:'approved', flashDiscount:null, photos:[] },
    { cat:'automobile', icon:'🚕', titre:'Honda CR-V 2019',         prixUSD:30000,  vendeur:'Yao Pélagie',     vendeurId:'demo', localisation:'Abidjan, Marcory', annee:'2019', km:'55,000 km', boite:'Auto', carb:'Essence', couleur:'Blanche', desc:'Très bon état, carnet entretenu.', status:'approved', flashDiscount:null, photos:[] },
    { cat:'maison',     icon:'🏘️', titre:'Villa 5P Marcory',        prixUSD:100000, vendeur:'Konan Kouamé',    vendeurId:'demo', localisation:'Abidjan, Marcory', surface:'250m²', pieces:'5', annee:'2020', desc:'Grande villa avec piscine, 2 garages.', status:'approved', flashDiscount:null, photos:[] },
    { cat:'automobile', icon:'🚗', titre:'Toyota RAV4 — PROMO',     prixUSD:23800,  prixUSDold:33800, vendeur:'Konan Kouamé', vendeurId:'demo', localisation:'Abidjan, Cocody', annee:'2018', km:'45,000 km', boite:'Auto', carb:'Essence', couleur:'Noire', desc:'Offre flash limitée. Excellent état.', status:'approved', flashDiscount:30, photos:[] },
    { cat:'maison',     icon:'🏡', titre:'Villa Cocody 4P — PROMO', prixUSD:69200,  prixUSDold:92300, vendeur:'Amani Touré',  vendeurId:'demo', localisation:'Abidjan, Cocody', surface:'200m²', pieces:'4', annee:'2022', desc:'Offre flash. Villa moderne.', status:'approved', flashDiscount:25, photos:[] },
    { cat:'automobile', icon:'🚘', titre:'Mercedes GLC 2020',       prixUSD:43000,  vendeur:'Bamba Souleymane',vendeurId:'demo', localisation:'Abidjan, Cocody', annee:'2020', km:'32,000 km', boite:'Auto', carb:'Diesel', couleur:'Grise', desc:'Très bon état général, toutes options.', status:'approved', flashDiscount:null, photos:[] },
    { cat:'pieces',     icon:'⚙️', titre:'Jantes Toyota 17"',       prixUSD:350,    vendeur:'Pièces Auto CI',  vendeurId:'demo', localisation:'Abidjan, Adjamé', desc:'Set de 4 jantes originales Toyota 17 pouces. Parfait état.', status:'approved', flashDiscount:null, photos:[] },
  ];
  console.log('🌱 Seed Firestore AG Prime...');
  for (const a of seed) {
    await addDoc(collection(db, 'annonces'), { ...a, createdAt: serverTimestamp() });
    console.log('  ✅', a.titre);
  }
  console.log('🎉 Base initialisée ! Rechargez la page.');
};

export { db, auth, storage };
