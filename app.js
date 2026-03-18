import { db } from "./firebase-config.js";
import { doc, setDoc, getDoc, updateDoc, onSnapshot, collection, query, orderBy, limit, getDocs } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// --- データ定義 ---
const BLESSINGS = {
  0: { name: "巨人の剛腕(+4)", max: 1 }, 1: { name: "あべこべの世界", max: 5 },
  2: { name: "混沌の儀式", max: 3 }, 3: { name: "再生の祈り", max: 2 },
  4: { name: "全反射", max: 1 }, 5: { name: "不屈の魂(初期HP+2)", max: 1 },
  6: { name: "審判の雷", max: 1 }, 7: { name: "復讐の誓い", max: 1 },
  8: { name: "聖なる盾", max: 1 }, 9: { name: "重力の呪縛(-4)", max: 1 }
};

// 初期デッキ枚数定義
const INITIAL_DECK_COUNTS = { 0: 1, 1: 16, 2: 8, 3: 5, 4: 4, 5: 3, 6: 2, 7: 2, 8: 2, 9: 1 };

// --- DOM取得 ---
const screens = { lobby: document.getElementById("lobby-screen"), game: document.getElementById("game-screen"), result: document.getElementById("result-screen") };
const ui = {
  myId: document.getElementById("my-id-display"), points: document.getElementById("my-points"), bet: document.getElementById("bet-points"),
  ranking: document.getElementById("ranking-list"), blessings: document.getElementById("blessing-container"),
  targetInput: document.getElementById("target-id-input"), matchBtn: document.getElementById("match-btn"), status: document.getElementById("status-message"),
  myHP: document.getElementById("my-hp"), oppHP: document.getElementById("opponent-hp"), myField: document.getElementById("my-field"), oppField: document.getElementById("opponent-field"),
  gameMsg: document.getElementById("game-message"), hand: document.getElementById("my-hand"), unionBtn: document.getElementById("union-btn"), activeBlessings: document.getElementById("active-blessings"),
  resTitle: document.getElementById("result-title"), resPoint: document.getElementById("result-point-info"), backBtn: document.getElementById("back-lobby-btn")
};

// --- グローバル状態 ---
let state = {
  uid: "", points: 0, betPts: 0, roomID: "", isHost: false, targetUID: "",
  selectedBlessings: [], blessingCounts: {},
  myInventory: {}, // 手札（残弾数）
  isUnionMode: false, unionCount: 2, lastCardSum: null,
  turnCard1: null, turnCard2: null, turnBlessing: null, isProcessing: false
};
let listeners = { opponent: null, room: null };

// --- 共通ユーティリティ ---
const formatUID = (uid) => uid ? `${uid.slice(0,3)}-${uid.slice(3,6)}-${uid.slice(6,9)}` : "";
const generateUID = () => Math.floor(100000000 + Math.random() * 900000000).toString();

// ----------------------------------
// ロビー処理
// ----------------------------------

async function loadRanking() {
  ui.ranking.innerHTML = "<li>読み込み中...</li>";
  try {
    const q = query(collection(db, "users"), orderBy("points", "desc"), limit(5));
    const snap = await getDocs(q);
    ui.ranking.innerHTML = "";
    if(snap.empty) ui.ranking.innerHTML = "<li>まだデータがありません</li>";
    snap.forEach(doc => {
      const li = document.createElement("li");
      li.innerHTML = `<b>${doc.data().points} pt</b> - ID: ${formatUID(doc.id)}`;
      ui.ranking.appendChild(li);
    });
  } catch (e) { ui.ranking.innerHTML = "<li>取得失敗</li>"; }
}

// ★ご要望：読めるように縦一列リストに生成
function renderBlessingSetup() {
  ui.blessings.innerHTML = "";
  Object.keys(BLESSINGS).forEach(id => {
    const label = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.value = id; cb.className = "blessing-cb";
    cb.onchange = () => {
      const checked = screens.lobby.querySelectorAll('.blessing-cb:checked');
      if(checked.length > 3) cb.checked = false; // 3つまで制限
    };
    label.appendChild(cb);
    const span = document.createElement("span");
    span.className = "blessing-info-text";
    span.textContent = ` ${BLESSINGS[id].name}`;
    label.appendChild(span);
    ui.blessings.appendChild(label);
  });
}

async function init() {
  state.uid = localStorage.getItem("myUID") || generateUID();
  localStorage.setItem("myUID", state.uid);
  ui.myId.textContent = formatUID(state.uid);

  // 画面リセット
  screens.lobby.style.display = "block"; screens.game.style.display = "none"; screens.result.style.display = "none";
  ui.matchBtn.disabled = false; ui.status.textContent = ""; ui.targetInput.value = "";

  // ユーザーデータ取得
  const userSnap = await getDoc(doc(db, "users", state.uid));
  if (!userSnap.exists()) {
    state.points = 100;
    await setDoc(doc(db, "users", state.uid), { points: 100, targetID: null });
  } else {
    state.points = userSnap.data().points;
  }
  ui.points.textContent = state.points;
  // 賭け金計算
  state.betPts = Math.ceil(state.points * 0.05);
  ui.bet.textContent = state.betPts;

  // ロビー表示生成
  loadRanking();
  renderBlessingSetup();
}

ui.matchBtn.addEventListener("click", async () => {
  const targetID = ui.targetInput.value.replace(/[^0-9]/g, "");
  if (targetID.length !== 9 || targetID === state.uid) return alert("自分以外の正しい9桁のIDを入力してください");

  // 加護の取得
  const checked = screens.lobby.querySelectorAll('.blessing-cb:checked');
  state.selectedBlessings = Array.from(checked).map(cb => parseInt(cb.value));
  if(state.selectedBlessings.length === 0) return alert("加護を1つ以上選んでください");

  // マッチング待機状態へ
  ui.matchBtn.disabled = true; ui.status.textContent = "相手の入力を待っています...";
  await updateDoc(doc(db, "users", state.uid), { targetID: targetID });

  if (listeners.opponent) listeners.opponent();
  listeners.opponent = onSnapshot(doc(db, "users", targetID), (snap) => {
    if (snap.exists() && snap.data().targetID === state.uid) {
      ui.status.textContent = "マッチング成功！連動します...";
      listeners.opponent();
      setTimeout(() => startGame(targetID), 1000);
    }
  });
});

// ----------------------------------
// ゲーム本編（バトル）
// ----------------------------------

// ★ご要望：常に0～9を選べる横スクロール手札の描画
const renderInventoryHand = () => {
  ui.hand.innerHTML = ""; // クリア
  
  // 0から9まで順番に生成
  for (let num = 0; num <= 9; num++) {
    const count = state.myInventory[num] || 0;
    
    const cardEl = document.createElement("div");
    cardEl.className = "hand-card";
    cardEl.textContent = num;

    // ★ご要望：枚数を右下に表示
    const countEl = document.createElement("span");
    countEl.className = "card-count";
    countEl.textContent = `${count}枚`;
    cardEl.appendChild(countEl);

    // ±3ルールの判定
    const isOk = checkPlusMinus3(num);
    if (count <= 0 || !isOk || state.isProcessing) {
      cardEl.classList.add("disabled");
    }

    // 合体モードでの選択状態
    if (state.turnCard1 === num && state.isUnionMode) { cardEl.classList.add("selected"); }

    // クリック処理
    cardEl.onclick = () => {
      if(cardEl.classList.contains("disabled")) return;
      handleCardSelection(num);
    };

    ui.hand.appendChild(cardEl);
  }
};

// ±3判定（免除ルール付き）
const checkPlusMinus3 = (num) => {
  if (state.lastCardSum === null) return true;
  // 手札（残弾があるもの）の中に、±3を満たすものが1つでもあるか？
  let hasValidCard = false;
  for(let i=0; i<=9; i++){
    if((state.myInventory[i] || 0) > 0){
      if(Math.abs(i - state.lastCardSum) >= 3) { hasValidCard = true; break; }
    }
  }
  // 満たすカードがない場合は、どのカードを出してもOK（フリーズ防止）
  if (!hasValidCard) return true; 
  // 満たすカードがあるなら、ちゃんと判定
  return Math.abs(num - state.lastCardSum) >= 3;
};

// カード選択時のロジック
const handleCardSelection = async (num) => {
  if (state.isProcessing) return;

  if (state.isUnionMode) {
    // 合体モード
    if (state.turnCard1 === null) {
      state.turnCard1 = num;
      // 1枚目はまだInventoryを減らさない（キャンセル可能にするため）
      renderInventoryHand(); // 選択状態を描画
      return;
    } else {
      // 2枚目選択
      state.turnCard2 = num;
      // 両方のInventoryを減らす
      state.myInventory[state.turnCard1]--;
      state.myInventory[state.turnCard2]--;
      state.unionCount--;
      state.isUnionMode = false;
      ui.unionBtn.classList.remove("active");
      ui.unionBtn.textContent = `合体(残${state.unionCount})`;
    }
  } else {
    // 通常モード
    state.turnCard1 = num;
    // 混沌の儀式(2)使用時は枚数を減らさない
    if(state.turnBlessing !== 2) { state.myInventory[num]--; }
    else { /* 混沌時はランダム数字に上書き */ state.turnCard1 = Math.floor(Math.random()*10); }
  }

  // 決定処理
  state.isProcessing = true;
  ui.myField.textContent = "セット済"; ui.myField.style.background = "#34495e"; ui.myField.classList.remove("open");
  
  // 最後に使った数字（±3判定用）を更新
  state.lastCardSum = state.turnCard2 !== null ? state.turnCard1 + state.turnCard2 : state.turnCard1;
  document.getElementById("last-card").textContent = state.lastCardSum;

  renderInventoryHand(); // 枚数表示を更新

  // Firebase更新
  await updateDoc(doc(db, "rooms", state.roomID), {
    [`${state.uid}_ready`]: true,
    [`${state.uid}_card1`]: state.turnCard1,
    [`${state.uid}_card2`]: state.turnCard2,
    [`${state.uid}_blessing`]: state.turnBlessing
  });

  // 加護の使用カウント減
  if(state.turnBlessing !== null) {
    state.blessingCounts[state.turnBlessing]--;
    state.turnBlessing = null; // ターン使用希望をクリア
    document.querySelectorAll(".blessing-btn-in-game").forEach(b=>b.classList.remove("selected"));
    updateBlessingButtonsUI(); // 残数をUIに反映
  }
};

const updateBlessingButtonsUI = () => {
  ui.activeBlessings.querySelectorAll("button").forEach(btn => {
    const id = btn.dataset.id;
    const count = state.blessingCounts[id];
    btn.textContent = `${BLESSINGS[id].name.split('(')[0]}(${count})`; // 名前を短縮して残数表示
    if(count <= 0) btn.disabled = true;
  });
};

const startGame = async (targetID) => {
  screens.lobby.style.display = "none"; screens.game.style.display = "flex";
  
  // 状態初期化
  state.targetUID = targetID;
  state.isHost = state.uid < targetID;
  state.roomID = state.isHost ? `${state.uid}_${targetID}` : `${targetID}_${state.uid}`;
  state.myHP = state.selectedBlessings.includes(5) ? 5 : 3; // 不屈の魂チェック
  state.oppHP = 3; state.unionCount = 2; state.lastCardSum = null; state.isProcessing = false;
  state.turnCard1 = null; state.turnCard2 = null; state.turnBlessing = null; state.isUnionMode = false;
  
  // ★ご要望：デッキはロビー（開始時）に自動でセット
  state.myInventory = { ...INITIAL_DECK_COUNTS }; // コピー

  // UI初期化
  ui.myHP.textContent = state.myHP; ui.oppHP.textContent = 3;
  ui.gameMsg.textContent = "VS"; ui.gameMsg.style.color = "#e74c3c";
  ui.myField.textContent = "選ぶ"; ui.myField.style.background = "#ecf0f1"; ui.myField.classList.remove("open");
  ui.oppField.textContent = "考え中"; ui.oppField.style.background = "#ecf0f1"; ui.oppField.classList.remove("open");
  ui.unionBtn.textContent = `合体(残2)`; ui.unionBtn.classList.remove("active");
  document.getElementById("last-card").textContent = "なし";
  document.getElementById("opp-blessing-msg").textContent = "";

  // 加護ボタン生成（ゲーム画面）
  ui.activeBlessings.innerHTML = "";
  state.blessingCounts = {};
  state.selectedBlessings.forEach(id => {
    state.blessingCounts[id] = BLESSINGS[id].max;
    if(id === 5) return; // 不屈の魂はボタン不要

    const btn = document.createElement("button");
    btn.className = "blessing-btn-in-game";
    btn.dataset.id = id;
    btn.onclick = () => {
      if (state.isProcessing) return;
      if (state.turnBlessing === id) { state.turnBlessing = null; btn.classList.remove("selected"); }
      else { state.turnBlessing = id; ui.activeBlessings.querySelectorAll("button").forEach(b=>b.classList.remove("selected")); btn.classList.add("selected"); }
    };
    ui.activeBlessings.appendChild(btn);
  });
  updateBlessingButtonsUI();
  ui.unionBtn.disabled = false;

  renderInventoryHand();

  // Firebase Room初期化
  if(state.isHost) {
    await setDoc(doc(db, "rooms", state.roomID), {
      [`${state.uid}_hp`]: state.myHP, [`${targetID}_hp`]: 3,
      [`${state.uid}_ready`]: false, [`${targetID}_ready`]: false,
      turn: 1
    });
  }

  // ルーム監視開始
  if (listeners.room) listeners.room();
  listeners.room = onSnapshot(doc(db, "rooms", state.roomID), (snap) => {
    if(!snap.exists()) return;
    const data = snap.data();
    
    // HP同期
    state.myHP = data[`${state.uid}_hp`]; state.oppHP = data[`${state.targetUID}_hp`];
    ui.myHP.textContent = state.myHP; ui.oppHP.textContent = state.oppHP;
    
    // 相手の待機状態表示
    if(data[`${state.targetUID}_ready`] && !data[`${state.uid}_ready`]) {
      ui.oppField.textContent = "セット済"; ui.oppField.style.background = "#34495e"; ui.oppField.style.color = "white";
    }

    // ★両者揃ったらバトル計算（Hostが代表して計算するが、演出は両方で行う）
    if(data[`${state.uid}_ready`] && data[`${state.targetUID}_ready`] && state.isProcessing) {
      resolveTurn演出(data);
    }
  });
};

// ----------------------------------
// 勝敗判定・演出ロジック（仕様書準拠）
// ----------------------------------
const resolveTurn演出 = (data) => {
  const me = state.uid; const opp = state.targetUID;
  const roomRef = doc(db, "rooms", state.roomID);

  // 加護の取得
  const myB = data[`${me}_blessing`]; const oppB = data[`${opp}_blessing`];
  
  // 素の数字計算（合体考慮）
  let myVal = data[`${me}_card1`] + (data[`${me}_card2`] || 0);
  let oppVal = data[`${opp}_card1`] + (data[`${opp}_card2`] || 0);

  // --- 計算フェーズ（仕様書の優先順位順） ---
  
  // 1. 弱体化(9)
  if(myB === 9) oppVal = Math.max(0, oppVal - 4); if(oppB === 9) myVal = Math.max(0, myVal - 4);
  // 2. 強化(0, 7)
  if(myB === 0) myVal += 4; if(oppB === 0) oppVal += 4;
  if(myB === 7) myVal += Math.max(0, (data[`${opp}_hp`] - data[`${me}_hp`]) * 2);
  if(oppB === 7) oppVal += Math.max(0, (data[`${me}_hp`] - data[`${opp}_hp`]) * 2);

  // 3. ルール変更（あべこべ(1)）-> 勝敗判定
  const isReverse = (myB === 1 || oppB === 1);
  let result = 0; // 0:draw, 1:myWin, 2:oppWin
  if (myVal === oppVal) result = 0;
  else if (!isReverse) result = (myVal > oppVal) ? 1 : 2;
  else result = (myVal < oppVal) ? 1 : 2; // あべこべ

  // 4. ダメージ処理（雷(6), 反射(4), 盾(8), 回復(3)）
  let myDmg = (result === 2) ? 1 : 0;
  let oppDmg = (result === 1) ? 1 : 0;

  if(result === 1 && myB === 6) oppDmg = 2; // 審判の雷
  if(result === 2 && oppB === 6) myDmg = 2;

  if(myB === 4 && result === 2) { myDmg = 0; oppDmg = 1; } // 全反射
  if(oppB === 4 && result === 1) { oppDmg = 0; myDmg = 1; }

  if(myB === 8 && myDmg > 0) myDmg = 0; // 聖なる盾
  if(oppB === 8 && oppDmg > 0) oppDmg = 0;

  // ライフ最終計算（回復(3)含む）
  let nextMyHP = data[`${me}_hp`] - myDmg + (myB === 3 ? 1 : 0);
  let nextOppHP = data[`${opp}_hp`] - oppDmg + (oppB === 3 ? 1 : 0);

  // --- 演出フェーズ ---
  
  // カードオープン
  ui.myField.textContent = myVal; ui.myField.classList.add("open"); ui.myField.style.background = "white";
  ui.oppField.textContent = oppVal; ui.oppField.classList.add("open"); ui.oppField.style.background = "white";
  
  // 相手の使用加護表示
  document.getElementById("opp-blessing-msg").textContent = oppB !== null ? `相手:${BLESSINGS[oppB].name.split('(')[0]}` : "";

  // メッセージ
  if(result === 1) { ui.gameMsg.textContent = "WIN! 🎉"; ui.gameMsg.style.color = "#f1c40f"; }
  else if(result === 2) { ui.gameMsg.textContent = "LOSE... 💦"; ui.gameMsg.style.color = "#3498db"; }
  else { ui.gameMsg.textContent = "DRAW ⚔️"; ui.gameMsg.style.color = "white"; }

  // 3秒後に次のターンまたは決着
  setTimeout(async () => {
    // ホストが代表してDB更新
    if(state.isHost) {
      if(nextMyHP <= 0 || nextOppHP <= 0) {
        // 決着データ書き込み
        await updateDoc(roomRef, { [`${me}_hp`]: nextMyHP, [`${opp}_hp`]: nextOppHP, gameOver: true, winner: (nextMyHP > nextOppHP ? me : opp) });
      } else {
        // 次のターンへリセット
        await updateDoc(roomRef, {
          [`${me}_hp`]: nextMyHP, [`${opp}_hp`]: nextOppHP,
          [`${me}_ready`]: false, [`${opp}_ready`]: false,
          [`${me}_card1`]: null, [`${me}_card2`]: null, [`${me}_blessing`]: null,
          [`${opp}_card1`]: null, [`${opp}_card2`]: null, [`${opp}_blessing`]: null,
          turn: data.turn + 1
        });
      }
    }

    // ホスト以外も gameOver を検知してリザルトへ行くためのリセット処理
    if(nextMyHP <= 0 || nextOppHP <= 0) {
      if(listeners.room) listeners.room(); // 監視停止
      showResult(nextMyHP > nextOppHP); // HPが多いほうが勝ち
    } else {
      // 次のターンへのUIリセット
      ui.myField.textContent = "選ぶ"; ui.myField.style.background = "#ecf0f1"; ui.myField.classList.remove("open");
      ui.oppField.textContent = "考え中"; ui.oppField.style.background = "#ecf0f1"; ui.oppField.classList.remove("open");
      document.getElementById("opp-blessing-msg").textContent = "";
      ui.gameMsg.textContent = "VS"; ui.gameMsg.style.color = "#e74c3c";
      state.turnCard1 = null; state.turnCard2 = null; state.turnBlessing = null; state.isProcessing = false;
      renderInventoryHand(); // disabled解除
    }
  }, 3000);
};

// ----------------------------------
// リザルト・ポイント処理
// ----------------------------------
const showResult = async (isWin) => {
  screens.game.style.display = "none"; screens.result.style.display = "block";
  
  // 最終ポイント計算
  let finalPoints = state.points;
  let pointChangeMsg = "";
  
  if(isWin) {
    ui.resTitle.textContent = "🏆 勝利！ 🏆"; ui.resTitle.style.color = "#f1c40f";
    const gain = (state.points === 0) ? 10 : state.betPts; // 破産救済
    finalPoints += gain;
    pointChangeMsg = `ポイント獲得: +${gain} pt`;
  } else {
    ui.resTitle.textContent = "💀 敗北... 💀"; ui.resTitle.style.color = "#e74c3c";
    finalPoints = Math.max(0, finalPoints - state.betPts);
    pointChangeMsg = `ポイント喪失: -${state.betPts} pt`;
  }

  ui.resPoint.textContent = `${pointChangeMsg} (現在: ${finalPoints} pt)`;

  // DB更新（ポイント確定、ターゲットリセット）
  await updateDoc(doc(db, "users", state.uid), { points: finalPoints, targetID: null });
  state.points = finalPoints; // ローカル状態更新
};

ui.backBtn.addEventListener("click", () => { init(); }); // ロビーへリロード

// 起動
init();
