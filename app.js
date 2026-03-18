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
    await updateDoc(doc(db, "users", myUID), { targetID: targetID });

    if (opponentListener) opponentListener(); 
    
    opponentListener = onSnapshot(doc(db, "users", targetID), (docSnap) => {
      if (docSnap.exists()) {
        const opponentData = docSnap.data();
        if (opponentData.targetID === myUID) {
          statusMessage.textContent = "🔥 マッチング成功！対戦準備中... 🔥";
          statusMessage.style.color = "#e74c3c";
          opponentListener(); 
          
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

// --- 2. ゲーム本編（バトル）の処理 ---

let myDeck = [];
let myHand = [];
let roomID = "";
let opponentUID = "";
let isHost = false;           // 処理の重複を防ぐための「親機」判定
let isProcessingTurn = false; // アニメーション中にカードを押せないようにするバリア
let roomListener = null;

const generateDeck = () => {
  const pool = [0,...Array(16).fill(1),...Array(8).fill(2),...Array(5).fill(3),...Array(4).fill(4),...Array(3).fill(5),...Array(2).fill(6),...Array(2).fill(7),...Array(2).fill(8),9];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 30);
};

const renderHand = () => {
  myHandContainer.innerHTML = ""; 
  myHand.forEach((cardNumber, index) => {
    const cardEl = document.createElement("div");
    cardEl.className = "hand-card";
    cardEl.textContent = cardNumber;
    
    // 手札のカードをクリックした時
    cardEl.onclick = async () => {
      if (isProcessingTurn) return; // 処理中は何もしない

      const roomRef = doc(db, "rooms", roomID);
      const docSnap = await getDoc(roomRef);
      if (docSnap.data()[`${myUID}_card`] !== null) return; // 既にカードを出していたら何もしない

      // 手札からカードを消す
      myHand.splice(index, 1);
      renderHand();

      // UIを「セット済」に変更
      const myField = document.getElementById("my-field");
      myField.textContent = "セット済";
      myField.style.background = "#34495e";
      myField.style.color = "white";
      document.getElementById("game-message").textContent = "相手を待っています...";

      // Firestoreに「このカードを出した」と記録する
      await updateDoc(roomRef, {
        [`${myUID}_card`]: cardNumber
      });
    };
    
    myHandContainer.appendChild(cardEl);
  });
};

const startGame = async (targetID) => {
  lobbyScreen.style.display = "none";
  gameScreen.style.display = "flex";

  opponentUID = targetID;
  const idArray = [myUID, targetID].sort();
  roomID = `${idArray[0]}_${idArray[1]}`;
  
  // IDが小さい方を「ホスト（親機）」として、ライフ計算の代表者にする
  isHost = (myUID === idArray[0]); 

  myDeck = generateDeck();
  myHand = myDeck.splice(0, 5); 
  renderHand();

  // ルーム（対戦部屋）の初期データを作成
  await setDoc(doc(db, "rooms", roomID), {
    [`${myUID}_hp`]: 3,
    [`${myUID}_card`]: null,
    [`${opponentUID}_hp`]: 3,
    [`${opponentUID}_card`]: null,
    turn: 1
  }, { merge: true }); // お互いが同時に作っても上書きされない設定

  // 部屋の監視（バトルの進行）をスタート
  listenToRoom();
};

const listenToRoom = () => {
  const roomRef = doc(db, "rooms", roomID);
  
  roomListener = onSnapshot(roomRef, (docSnap) => {
    if (!docSnap.exists()) return;
    const data = docSnap.data();

    const myHP = data[`${myUID}_hp`];
    const oppHP = data[`${opponentUID}_hp`];
    const myCard = data[`${myUID}_card`];
    const oppCard = data[`${opponentUID}_card`];

    // ライフを画面に反映
    document.getElementById("my-hp").textContent = myHP;
    document.getElementById("opponent-hp").textContent = oppHP;

    const myField = document.getElementById("my-field");
    const oppField = document.getElementById("opponent-field");
    const gameMessage = document.getElementById("game-message");

    // 勝敗チェック（どちらかのライフが0以下になったら）
    if (myHP <= 0 || oppHP <= 0) {
      if (myHP <= 0 && oppHP <= 0) gameMessage.textContent = "引き分け！";
      else if (myHP <= 0) gameMessage.textContent = "あなたの負け...";
      else gameMessage.textContent = "あなたの勝ち！🎉";
      
      gameMessage.style.fontSize = "32px";
      if (roomListener) roomListener(); // 監視を止める
      return;
    }

    // --- 状態に合わせた画面の表示変更 ---
    
    // 何も出していない時
    if (myCard === null && oppCard === null && !isProcessingTurn) {
      myField.textContent = "カードを選ぶ";
      myField.style.background = "#ecf0f1";
      myField.style.color = "#2c3e50";
      oppField.textContent = "考え中...";
      oppField.style.background = "#ecf0f1";
      oppField.style.color = "#2c3e50";
      gameMessage.textContent = "VS";
      gameMessage.style.color = "#e74c3c";
    }

    // 相手だけがカードを出した時
    if (oppCard !== null && myCard === null && !isProcessingTurn) {
      oppField.textContent = "セット済";
      oppField.style.background = "#34495e";
      oppField.style.color = "white";
    }

    // ★両方がカードを出したらバトル発生！★
    if (myCard !== null && oppCard !== null && !isProcessingTurn) {
      isProcessingTurn = true; // アニメーション開始
      resolveBattle(myCard, oppCard, data, roomRef);
    }
  });
};

const resolveBattle = (myCardNum, oppCardNum, roomData, roomRef) => {
  const myField = document.getElementById("my-field");
  const oppField = document.getElementById("opponent-field");
  const gameMessage = document.getElementById("game-message");

  // カードをオープン（数字を見せる）
  myField.textContent = myCardNum;
  myField.style.background = "white";
  myField.style.color = "#2c3e50";
  
  oppField.textContent = oppCardNum;
  oppField.style.background = "white";
  oppField.style.color = "#2c3e50";

  // 勝敗判定
  let newMyHP = roomData[`${myUID}_hp`];
  let newOppHP = roomData[`${opponentUID}_hp`];

  if (myCardNum > oppCardNum) {
    gameMessage.textContent = "WIN! 🎉";
    gameMessage.style.color = "#f1c40f";
    if (isHost) newOppHP -= 1; // 親機だけが計算する
  } else if (myCardNum < oppCardNum) {
    gameMessage.textContent = "LOSE... 💦";
    gameMessage.style.color = "#3498db";
    if (isHost) newMyHP -= 1;
  } else {
    gameMessage.textContent = "DRAW ⚔️";
    gameMessage.style.color = "white";
  }

  // 3秒後に次のターンへ進む
  setTimeout(async () => {
    // 親機（Host）がデータベースを更新して次のターンへ
    if (isHost) {
      await updateDoc(roomRef, {
        [`${myUID}_hp`]: newMyHP,
        [`${opponentUID}_hp`]: newOppHP,
        [`${myUID}_card`]: null,       // 場をリセット
        [`${opponentUID}_card`]: null, // 場をリセット
        turn: roomData.turn + 1
      });
    }

    // デッキからカードを1枚引く（手札が8枚未満なら）
    if (myDeck.length > 0 && myHand.length < 8) {
      myHand.push(myDeck.shift());
    }
    renderHand();

    isProcessingTurn = false; // バリア解除
  }, 3000);
};

// プログラム開始
init();
