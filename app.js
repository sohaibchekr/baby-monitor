// 1. IMPORTANT: Remplacez l'objet firebaseConfig par le vôtre depuis la console Firebase
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-app.js";
import { getFirestore, collection, doc, setDoc, getDoc, updateDoc, onSnapshot, addDoc } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js";

// 👇👇👇 A REMPLACER PAR VOTRE CONFIGURATION FIREBASE 👇👇👇
const firebaseConfig = {
  apiKey: "VOTRE_API_KEY",
  authDomain: "VOTRE_PROJET.firebaseapp.com",
  projectId: "VOTRE_PROJET",
  storageBucket: "VOTRE_PROJET.appspot.com",
  messagingSenderId: "VOTRE_SENDER_ID",
  appId: "VOTRE_APP_ID"
};
// 👆👆👆 ------------------------------------------ 👆👆👆

// Initialisation de Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Configuration WebRTC (Serveur STUN de Google, gratuit)
const configuration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

let peerConnection = null;
let localStream = null;
let remoteStream = null;

// Éléments de l'interface
const uiHome = document.getElementById('home-screen');
const uiCamera = document.getElementById('camera-screen');
const uiViewer = document.getElementById('viewer-screen');
const inputRoom = document.getElementById('room-id');

// --- 📷 MODE CAMÉRA (BÉBÉ) ---
document.getElementById('btn-camera').addEventListener('click', async () => {
  const roomId = inputRoom.value.trim().toLowerCase();
  if (!roomId) return alert("Veuillez entrer un code de chambre !");
  
  document.getElementById('cam-room-display').innerText = roomId;
  uiHome.classList.add('hidden');
  uiCamera.classList.remove('hidden');

  const videoElement = document.getElementById('local-video');

  try {
    // 1. Accès à la caméra et micro du téléphone
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    videoElement.srcObject = localStream;

    peerConnection = new RTCPeerConnection(configuration);

    // 2. Ajouter les pistes audio/vidéo à la connexion Peer2Peer
    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });

    const roomRef = doc(db, 'rooms', roomId);
    const callerCandidatesCollection = collection(roomRef, 'callerCandidates');

    // 3. Envoyer les candidats ICE (Trajets réseau) vers Firebase
    peerConnection.addEventListener('icecandidate', event => {
      if (event.candidate) {
        addDoc(callerCandidatesCollection, event.candidate.toJSON());
      }
    });

    // 4. Créer l'Offre WebRTC (L'invitation) et la stocker sur Firebase
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    
    await setDoc(roomRef, {
      offer: { type: offer.type, sdp: offer.sdp }
    });

    // 5. Attendre que le parent (visionneur) réponde
    onSnapshot(roomRef, async snapshot => {
      const data = snapshot.data();
      if (!peerConnection.currentRemoteDescription && data && data.answer) {
        const rtcSessionDescription = new RTCSessionDescription(data.answer);
        await peerConnection.setRemoteDescription(rtcSessionDescription);
      }
    });

    // 6. Écouter les candidats réseau du parent pour se connecter
    const calleeCandidatesCollection = collection(roomRef, 'calleeCandidates');
    onSnapshot(calleeCandidatesCollection, snapshot => {
      snapshot.docChanges().forEach(async change => {
        if (change.type === 'added') {
          let data = change.doc.data();
          await peerConnection.addIceCandidate(new RTCIceCandidate(data));
        }
      });
    });

  } catch (error) {
    alert("Erreur d'accès à la caméra : " + error.message);
  }
});


// --- 📱 MODE VISIONNEUR (PARENT) ---
document.getElementById('btn-viewer').addEventListener('click', async () => {
  const roomId = inputRoom.value.trim().toLowerCase();
  if (!roomId) return alert("Veuillez entrer un code de chambre !");

  document.getElementById('view-room-display').innerText = roomId;
  uiHome.classList.add('hidden');
  uiViewer.classList.remove('hidden');

  const remoteVideo = document.getElementById('remote-video');

  peerConnection = new RTCPeerConnection(configuration);
  remoteStream = new MediaStream();
  remoteVideo.srcObject = remoteStream;

  // Recevoir les pistes vidéo/audio de la caméra
  peerConnection.addEventListener('track', event => {
    event.streams[0].getTracks().forEach(track => {
      remoteStream.addTrack(track);
    });
  });

  const roomRef = doc(db, 'rooms', roomId);
  const roomSnapshot = await getDoc(roomRef);

  if (!roomSnapshot.exists()) {
    uiViewer.classList.add('hidden');
    uiHome.classList.remove('hidden');
    return alert(`La chambre '${roomId}' n'existe pas. Veuillez lancer la Caméra en premier !`);
  }

  // Envoyer ses propres candidats réseau via Firebase
  const calleeCandidatesCollection = collection(roomRef, 'calleeCandidates');
  peerConnection.addEventListener('icecandidate', event => {
    if (event.candidate) {
      addDoc(calleeCandidatesCollection, event.candidate.toJSON());
    }
  });

  // Lire l'Offre de la caméra et générer la Réponse
  const offer = roomSnapshot.data().offer;
  await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);

  // Sauvegarder la réponse sur Firebase pour que la caméra la lise
  await updateDoc(roomRef, {
    answer: { type: answer.type, sdp: answer.sdp }
  });

  // Écouter les chemins réseaux de la caméra pour lier la vidéo en direct
  const callerCandidatesCollection = collection(roomRef, 'callerCandidates');
  onSnapshot(callerCandidatesCollection, snapshot => {
    snapshot.docChanges().forEach(async change => {
      if (change.type === 'added') {
        let data = change.doc.data();
        await peerConnection.addIceCandidate(new RTCIceCandidate(data));
      }
    });
  });
});

// --- Bouton Plein écraan (Visionneur) ---
document.getElementById('btn-fullscreen').addEventListener('click', () => {
  const elem = document.getElementById('viewer-screen');
  if (elem.requestFullscreen) elem.requestFullscreen();
  else if (elem.webkitRequestFullscreen) elem.webkitRequestFullscreen();
});
