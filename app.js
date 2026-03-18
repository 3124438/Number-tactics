// app.js
import { db } from "./firebase-config.js";
import { doc, setDoc, getDoc, updateDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// DOM要素（画面のパーツ）を取得
const myIdDisplay = document.getElementById("my-id-display");
const myPointsDisplay = document.getElementById("my-points");
const statusMessage = document.getElementById("status-message");
const targetIdInput = document.getElementById("target-id-input");
const matchBtn = document.getElementById("match-btn");

let myUID = "";
let opponentListener = null; // 相手の動きを監視するタイマーのようなもの

// ★追加：9桁の数字を「000-000-000」の形にする関数
const formatUID = (uid) => {
  if (!uid) return "";
  return `${uid.slice(0,3)}-${uid.slice(3,6)}-${uid.slice(6,9)}`;
};

// 9桁のランダムな数字を作る関数
const generateUID = () => {
  return Math.floor(100000000 + Math.random() * 900000000).toString();
};

// 初期設定関数
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

  // ★変更：画面にはハイフン付きで表示する
  myIdDisplay.textContent = formatUID(myUID);
  if (myPointsDisplay.textContent === "---") myPointsDisplay.textContent = 100;
  statusMessage.textContent = "対戦相手のID入力を待っています...";
}

// ★追加：「対戦を申し込む」ボタンを押した時の処理
matchBtn.addEventListener("click", async () => {
  // 入力された文字からハイフンや空白を取り除き、数字(9桁)だけを抽出する
  const targetID = targetIdInput.value.replace(/[^0-9]/g, "");

  // 入力チェック
  if (targetID.length !== 9) {
    alert("IDは9桁の数字で入力してください！");
    return;
  }
  if (targetID === myUID) {
    alert("自分のIDは入力できません！");
    return;
  }

  // ボタンを連打できないようにする
  matchBtn.disabled = true;
  statusMessage.textContent = "相手の承認（入力）を待っています...";

  try {
    // 自分のデータベースに「この人と戦いたい！」と書き込む
    await updateDoc(doc(db, "users", myUID), {
      targetID: targetID
    });

    // ★重要：相手のデータベースを「リアルタイム監視」する
    if (opponentListener) opponentListener(); // 前の監視があればリセット
    
    opponentListener = onSnapshot(doc(db, "users", targetID), (docSnap) => {
      if (docSnap.exists()) {
        const opponentData = docSnap.data();
        
        // 相手も自分のIDを入力してくれたら（相思相愛）
        if (opponentData.targetID === myUID) {
          statusMessage.textContent = "🔥 マッチング成功！対戦準備中... 🔥";
          statusMessage.style.color = "#e74c3c";
          
          // 監視を終了する
          opponentListener();
          
          // ※ここで対戦画面へ切り替える処理を呼び出します
          // （今はテスト用にアラートを出します）
          setTimeout(() => alert("ゲーム画面へ移動します！"), 500);
        }
      }
    });

  } catch (error) {
    console.error(error);
    statusMessage.textContent = "エラーが発生しました";
    matchBtn.disabled = false;
  }
});

// プログラムをスタート
init();
