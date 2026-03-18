// app.js
import { db } from "./firebase-config.js";
import { doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// DOM要素（画面のパーツ）を取得
const myIdDisplay = document.getElementById("my-id-display");
const myPointsDisplay = document.getElementById("my-points");
const statusMessage = document.getElementById("status-message");

// 9桁のランダムな数字を作る関数
const generateUID = () => {
  return Math.floor(100000000 + Math.random() * 900000000).toString();
};

// 初期設定関数
async function init() {
  // ブラウザに保存されているIDがあるか確認
  let myUID = localStorage.getItem("myUID");

  // もし初めて遊ぶ人なら、新しいIDを作ってFirestoreに保存する
  if (!myUID) {
    myUID = generateUID();
    localStorage.setItem("myUID", myUID); // ブラウザに記憶
    
    try {
      // Firestoreの "users" コレクションに初期データを登録
      await setDoc(doc(db, "users", myUID), {
        points: 100,      // 初期ポイント
        targetID: null,   // まだ誰も入力していない
        status: "waiting" // 待機中
      });
      console.log("新規ユーザーを登録しました");
    } catch (error) {
      console.error("エラー:", error);
      statusMessage.textContent = "データベースへの保存に失敗しました";
      return;
    }
  } else {
    // 既存ユーザーの場合、ポイントなどをFirestoreから読み込む
    const userSnap = await getDoc(doc(db, "users", myUID));
    if (userSnap.exists()) {
      const userData = userSnap.data();
      myPointsDisplay.textContent = userData.points;
    }
  }

  // 画面にIDと初期ポイントを表示
  myIdDisplay.textContent = myUID;
  if (myPointsDisplay.textContent === "---") {
      myPointsDisplay.textContent = 100;
  }
  statusMessage.textContent = "対戦相手のID入力を待っています...";
}

// プログラムをスタート
init();
