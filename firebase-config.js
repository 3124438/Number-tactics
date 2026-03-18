// firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// ★以下の部分を、あなたのFirebaseコンソールの「firebaseConfig」に書き換えてください★
const firebaseConfig = {
  apiKey: "AIzaSyADaEm65XyMiwZE_PZ0aByyyfy41aENr9U",
  authDomain: "number-tactics-e6b10.firebaseapp.com",
  projectId: "number-tactics-e6b10",
  storageBucket: "number-tactics-e6b10.firebasestorage.app",
  messagingSenderId: "331575867383",
  appId: "1:331575867383:web:6f3e0f0a714aec9a6160f2"
};
// ★書き換えはここまで★

// Firebaseの初期化
const app = initializeApp(firebaseConfig);
// データベース（Firestore）を使えるようにして、他のファイルに渡す
export const db = getFirestore(app);
