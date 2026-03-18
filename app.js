import { db } from "./firebase-config.js";
import { doc, setDoc, getDoc, updateDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// DOM要素の取得
const myIdDisplay = document.getElementById("my-id-display");
const myPointsDisplay = document.getElementById("my-points");
const statusMessage = document.getElementById("status-message");
const targetIdInput = document.getElementById("target-id-input");
const matchBtn = document.getElementById("match-btn");

const lobbyScreen = document.getElementById("lobby-screen");
const gameScreen = document.getElementById("game-screen");
const myHandContainer = document.getElementById("my-hand");

let myUID = "";
let opponentListener = null; 

// --- 1. ロビー＆マッチング処理 ---

const formatUID = (uid) => {
  if (!uid) return "";
  return `${uid.slice(0,3)}-${uid.slice(3,6)}-${uid.slice(6,9)}`;
};

const generateUID = () => {
  return Math.floor(100000000 + Math.random() * 900000000).toString();
};

async function init() {
  myUID = localStorage.getItem("myUID");

  if (!myUID) {
    myUID = generateUID();
    localStorage.setItem("myUID", myUID); 
    try {
      await setDoc(doc(db, "users", myUID), {
        points: 100,      
        targetID: null,   
        status: "waiting" 
      });
    } catch (error) {
      console.error("エラー:", error);
      statusMessage.textContent = "データベースへの保存に失敗しました";
      return;
    }
  } else {
    const userSnap = await getDoc(doc(db, "users", myUID));
    if (userSnap.exists()) {
      myPointsDisplay.textContent = userSnap.data().points;
    }
  }

  myIdDisplay.textContent = formatUID(myUID);
  if (myPointsDisplay.textContent === "---") myPointsDisplay.textContent = 100;
  statusMessage.textContent = "対戦相手のID入力を待っています...";
}

matchBtn.addEventListener("click", async () => {
  const targetID = targetIdInput.value.replace(/[^0-9]/g, "");

  if (targetID.length !== 9) {
    alert("IDは9桁の数字で入力してください！");
    return;
  }
  if (targetID === myUID) {
    alert("自分のIDは入力できません！");
    return;
  }

  matchBtn.disabled = true;
  statusMessage.textContent = "相手の承認（入力）を待っています...";

  try {
    await updateDoc(doc(db, "users", myUID), {
      targetID: targetID
    });

    if (opponentListener) opponentListener(); 
    
    opponentListener = onSnapshot(doc(db, "users", targetID), (docSnap) => {
      if (docSnap.exists()) {
        const opponentData = docSnap.data();
        if (opponentData.targetID === myUID) {
          statusMessage.textContent = "🔥 マッチング成功！対戦準備中... 🔥";
          statusMessage.style.color = "#e74c3c";
          opponentListener(); 
          
          // マッチング成功から1秒後にゲーム画面へ切り替え
          setTimeout(() => {
            startGame(targetID); 
          }, 1000);
        }
      }
    });

  } catch (error) {
    console.error(error);
    statusMessage.textContent = "エラーが発生しました";
    matchBtn.disabled = false;
  }
});

// --- 2. ゲーム本編の処理 ---

let myDeck = [];
let myHand = [];
let roomID = "";

// デッキ(30枚)を作成する
const generateDeck = () => {
  const pool = [
    0, 
    ...Array(16).fill(1), 
    ...Array(8).fill(2), 
    ...Array(5).fill(3), 
    ...Array(4).fill(4), 
    ...Array(3).fill(5), 
    ...Array(2).fill(6), 
    ...Array(2).fill(7), 
    ...Array(2).fill(8), 
    9
  ];
  // シャッフル
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 30);
};

// 手札を画面に表示する
const renderHand = () => {
  myHandContainer.innerHTML = ""; 
  myHand.forEach((cardNumber) => {
    const cardEl = document.createElement("div");
    cardEl.className = "hand-card";
    cardEl.textContent = cardNumber;
    
    // カードをクリックした時の動き
    cardEl.onclick = () => {
      alert(`${cardNumber} のカードが選ばれました！`);
    };
    
    myHandContainer.appendChild(cardEl);
  });
};

// ゲーム開始！
const startGame = (targetID) => {
  // ロビーを消してゲーム画面を出す
  lobbyScreen.style.display = "none";
  gameScreen.style.display = "flex";

  // 共通のルームIDを作る
  const idArray = [myUID, targetID].sort();
  roomID = `${idArray[0]}_${idArray[1]}`;
  
  // デッキを作って5枚引く
  myDeck = generateDeck();
  myHand = myDeck.splice(0, 5); 

  // 手札を表示
  renderHand();
};

// プログラム開始
init();
