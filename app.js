import { db } from "./firebase-config.js";
import { doc, setDoc, getDoc, updateDoc, onSnapshot, collection, query, orderBy, limit, getDocs } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// --- ★データ定義（説明文を追加） ---
const BLESSINGS = {
  0: { name: "巨人の剛腕(+4)", max: 1, desc: "このターンの自分の数字を +4 する。" }, 
  1: { name: "あべこべの世界", max: 5, desc: "このターンのみ、「数字が小さい方」が勝利する。" },
  2: { name: "混沌の儀式", max: 3, desc: "手札を減らさず、0〜9のランダムな数字を出す。" }, 
  3: { name: "再生の祈り", max: 2, desc: "自分のライフを 1回復 する。" },
  4: { name: "全反射", max: 1, desc: "敗北時、ライフの減少を相手に変更する。" }, 
  5: { name: "不屈の魂(初期HP+2)", max: 1, desc: "試合開始時に 最大ライフ+2（計5）。" },
  6: { name: "審判の雷", max: 1, desc: "勝利時、相手へのダメージを 2 にする。" }, 
  7: { name: "復讐の誓い", max: 1, desc: "（相手L - 自分L）× 2 を自分の数字に加算。" },
  8: { name: "聖なる盾", max: 1, desc: "敗北してもライフが減らない。" }, 
  9: { name: "重力の呪縛(-4)", max: 1, desc: "相手が出したカードの数字を -4 する。" }
};

const DECK_LIMITS = { 0: 1, 1: 16, 2: 8, 3: 5, 4: 4, 5: 3, 6: 2, 7: 2, 8: 2, 9: 1 };
const DEFAULT_DECK = { 0:1, 1:10, 2:6, 3:4, 4:3, 5:2, 6:1, 7:1, 8:1, 9:1 }; 

// --- DOM取得 ---
const screens = { lobby: document.getElementById("lobby-screen"), game: document.getElementById("game-screen"), result: document.getElementById("result-screen") };
const ui = {
  myId: document.getElementById("my-id-display"), myIdBottom: document.getElementById("my-id-display-bottom"),
  points: document.getElementById("my-points"), myRank: document.getElementById("my-rank"), bet: document.getElementById("bet-points"),
  betPercentDisplay: document.getElementById("bet-percent-display"), betSlider: document.getElementById("bet-slider"),
  deckGrid: document.getElementById("deck-grid"), deckTotal: document.getElementById("deck-total"),
  ranking: document.getElementById("ranking-list"), blessings: document.getElementById("blessing-container"),
  targetInput: document.getElementById("target-id-input"), matchBtn: document.getElementById("match-btn"), status: document.getElementById("status-message"),
  myHP: document.getElementById("my-hp"), oppHP: document.getElementById("opponent-hp"), myField: document.getElementById("my-field"), oppField: document.getElementById("opponent-field"),
  gameMsg: document.getElementById("game-message"), hand: document.getElementById("my-hand"), unionBtn: document.getElementById("union-btn"), activeBlessings: document.getElementById("active-blessings"),
  resTitle: document.getElementById("result-title"), resPoint: document.getElementById("result-point-info"), backBtn: document.getElementById("back-lobby-btn"),
  turnResultOverlay: document.getElementById("turn-result-overlay"), turnResultMsg: document.getElementById("turn-result-msg"),
  turnOppCard: document.getElementById("turn-opp-card"), turnOppBlessing: document.getElementById("turn-opp-blessing"),
};

// --- グローバル状態 ---
let state = {
  uid: "", points: 0, betPercent: 5, betPts: 0, roomID: "", isHost: false, targetUID: "",
  selectedBlessings: [], blessingCounts: {},
  myDeckConfig: {}, myInventory: {}, 
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
    const q = query(collection(db, "users"), orderBy("points", "desc"));
    const snap = await getDocs(q);
    ui.ranking.innerHTML = "";
    if(snap.empty) {
      ui.ranking.innerHTML = "<li>まだデータがありません</li>";
      ui.myRank.textContent = "-";
      return;
    }
    
    let rank = 1; let myRankStr = "-"; let count = 0;
    snap.forEach(doc => {
      if (doc.id === state.uid) myRankStr = rank;
      if (count < 5) {
        const li = document.createElement("li");
        li.innerHTML = `<b>${rank}位: ${doc.data().points} pt</b> - ID: ${formatUID(doc.id)}`;
        ui.ranking.appendChild(li);
      }
      rank++; count++;
    });
    ui.myRank.textContent = myRankStr; 
  } catch (e) { ui.ranking.innerHTML = "<li>取得失敗</li>"; }
}

function updateBetPoints() {
  state.betPts = Math.max(1, Math.ceil(state.points * (state.betPercent / 100)));
  ui.bet.textContent = state.betPts;
}

ui.betSlider.addEventListener("input", (e) => {
  state.betPercent = parseInt(e.target.value);
  ui.betPercentDisplay.textContent = state.betPercent + "%";
  updateBetPoints();
});

function renderDeckEditor() {
  ui.deckGrid.innerHTML = "";
  let total = Object.values(state.myDeckConfig).reduce((a, b) => a + b, 0);
  ui.deckTotal.textContent = total;
  ui.deckTotal.style.color = (total === 30) ? "#27ae60" : "#e74c3c";
  
  for (let i = 0; i <= 9; i++) {
    const row = document.createElement("div"); row.className = "deck-row";
    const label = document.createElement("span"); label.className = "deck-label"; label.textContent = `[${i}]`;
    const limitText = document.createElement("span"); limitText.className = "deck-limit"; limitText.textContent = `上限${DECK_LIMITS[i]}`;
    const controls = document.createElement("div"); controls.className = "deck-controls";
    
    const minus = document.createElement("button"); minus.textContent = "-";
    minus.onclick = () => { if (state.myDeckConfig[i] > 0) { state.myDeckConfig[i]--; renderDeckEditor(); } };
    
    const count = document.createElement("span"); count.className = "deck-count"; count.textContent = state.myDeckConfig[i];
    
    const plus = document.createElement("button"); plus.textContent = "+";
    plus.onclick = () => { if (state.myDeckConfig[i] < DECK_LIMITS[i]) { state.myDeckConfig[i]++; renderDeckEditor(); } };
    
    controls.append(minus, count, plus); row.append(label, limitText, controls); ui.deckGrid.appendChild(row);
  }
  localStorage.setItem("myDeckConfig", JSON.stringify(state.myDeckConfig));
  
  if (total !== 30) {
    ui.matchBtn.disabled = true; ui.status.textContent = `デッキを30枚にしてください(現在${total}枚)`;
  } else {
    ui.matchBtn.disabled = false; ui.status.textContent = "";
  }
}

// ★加護の表示に説明文（desc）を追加
function renderBlessingSetup() {
  ui.blessings.innerHTML = "";
  Object.keys(BLESSINGS).forEach(id => {
    const label = document.createElement("label");
    
    const cb = document.createElement("input"); 
    cb.type = "checkbox"; cb.value = id; cb.className = "blessing-cb";
    cb.onchange = () => { if(screens.lobby.querySelectorAll('.blessing-cb:checked').length > 3) cb.checked = false; };
    
    const textContainer = document.createElement("div");
    textContainer.className = "blessing-text-container";

    const titleSpan = document.createElement("div"); 
    titleSpan.className = "blessing-info-title"; 
    titleSpan.textContent = BLESSINGS[id].name;

    const descSpan = document.createElement("div");
    descSpan.className = "blessing-info-desc";
    descSpan.textContent = BLESSINGS[id].desc;

    textContainer.appendChild(titleSpan);
    textContainer.appendChild(descSpan);

    label.appendChild(cb);
    label.appendChild(textContainer);
    ui.blessings.appendChild(label);
  });
}

async function init() {
  state.uid = localStorage.getItem("myUID") || generateUID();
  localStorage.setItem("myUID", state.uid);
  ui.myId.textContent = formatUID(state.uid);
  if(ui.myIdBottom) ui.myIdBottom.textContent = formatUID(state.uid);

  const savedDeck = localStorage.getItem("myDeckConfig");
  state.myDeckConfig = savedDeck ? JSON.parse(savedDeck) : { ...DEFAULT_DECK };

  screens.lobby.style.display = "block"; screens.game.style.display = "none"; screens.result.style.display = "none";
  ui.status.textContent = ""; ui.targetInput.value = "";

  const userSnap = await getDoc(doc(db, "users", state.uid));
  if (!userSnap.exists()) {
    state.points = 100; await setDoc(doc(db, "users", state.uid), { points: 100, targetID: null });
  } else {
    state.points = userSnap.data().points;
  }
  ui.points.textContent = state.points;
  
  ui.betSlider.value = state.betPercent; ui.betPercentDisplay.textContent = state.betPercent + "%";
  updateBetPoints(); loadRanking(); renderBlessingSetup(); renderDeckEditor();
}

ui.matchBtn.addEventListener("click", async () => {
  const targetID = ui.targetInput.value.replace(/[^0-9]/g, "");
  if (targetID.length !== 9 || targetID === state.uid) return alert("自分以外の正しい9桁のIDを入力してください");

  const checked = screens.lobby.querySelectorAll('.blessing-cb:checked');
  state.selectedBlessings = Array.from(checked).map(cb => parseInt(cb.value));
  if(state.selectedBlessings.length === 0) return alert("加護を1つ以上選んでください");

  if (Object.values(state.myDeckConfig).reduce((a, b) => a + b, 0) !== 30) return alert("デッキを30枚に調整してください");

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

const renderInventoryHand = () => {
  ui.hand.innerHTML = ""; 
  for (let num = 0; num <= 9; num++) {
    const count = state.myInventory[num] || 0;
    const cardEl = document.createElement("div"); cardEl.className = "hand-card"; cardEl.textContent = num;

    const countEl = document.createElement("span"); countEl.className = "card-count"; countEl.textContent = `${count}枚`;
    cardEl.appendChild(countEl);

    if (count <= 0 || !checkPlusMinus3(num) || state.isProcessing) cardEl.classList.add("disabled");
    if (state.turnCard1 === num && state.isUnionMode) cardEl.classList.add("selected");

    cardEl.onclick = () => { if(!cardEl.classList.contains("disabled")) handleCardSelection(num); };
    ui.hand.appendChild(cardEl);
  }
};

const checkPlusMinus3 = (num) => {
  if (state.lastCardSum === null) return true;
  let hasValidCard = false;
  for(let i=0; i<=9; i++){
    if((state.myInventory[i] || 0) > 0 && Math.abs(i - state.lastCardSum) >= 3) { hasValidCard = true; break; }
  }
  if (!hasValidCard) return true; 
  return Math.abs(num - state.lastCardSum) >= 3;
};

const handleCardSelection = async (num) => {
  if (state.isProcessing) return;

  if (state.isUnionMode) {
    if (state.turnCard1 === null) {
      state.turnCard1 = num; renderInventoryHand(); return;
    } else {
      state.turnCard2 = num;
      state.myInventory[state.turnCard1]--; state.myInventory[state.turnCard2]--;
      state.unionCount--; state.isUnionMode = false;
      ui.unionBtn.classList.remove("active"); ui.unionBtn.textContent = `合体(残${state.unionCount})`;
    }
  } else {
    state.turnCard1 = num;
    if(state.turnBlessing !== 2) { state.myInventory[num]--; } 
    else { state.turnCard1 = Math.floor(Math.random()*10); }
  }

  state.isProcessing = true;
  ui.myField.textContent = "セット済"; ui.myField.style.background = "#34495e"; ui.myField.classList.remove("open");
  
  state.lastCardSum = state.turnCard2 !== null ? state.turnCard1 + state.turnCard2 : state.turnCard1;
  document.getElementById("last-card").textContent = state.lastCardSum;
  renderInventoryHand();

  await updateDoc(doc(db, "rooms", state.roomID), {
    [`${state.uid}_ready`]: true, [`${state.uid}_card1`]: state.turnCard1, [`${state.uid}_card2`]: state.turnCard2, [`${state.uid}_blessing`]: state.turnBlessing
  });

  if(state.turnBlessing !== null) {
    state.blessingCounts[state.turnBlessing]--; state.turnBlessing = null; 
    document.querySelectorAll(".blessing-btn-in-game").forEach(b=>b.classList.remove("selected"));
    updateBlessingButtonsUI();
  }
};

const updateBlessingButtonsUI = () => {
  ui.activeBlessings.querySelectorAll("button").forEach(btn => {
    const id = btn.dataset.id; const count = state.blessingCounts[id];
    btn.textContent = `${BLESSINGS[id].name.split('(')[0]}(${count})`;
    if(count <= 0) btn.disabled = true;
  });
};

const startGame = async (targetID) => {
  screens.lobby.style.display = "none"; screens.game.style.display = "flex";
  
  state.targetUID = targetID; state.isHost = state.uid < targetID;
  state.roomID = state.isHost ? `${state.uid}_${targetID}` : `${targetID}_${state.uid}`;
  state.myHP = state.selectedBlessings.includes(5) ? 5 : 3;
  state.oppHP = 3; state.unionCount = 2; state.lastCardSum = null; state.isProcessing = false;
  state.turnCard1 = null; state.turnCard2 = null; state.turnBlessing = null; state.isUnionMode = false;
  
  state.myInventory = { ...state.myDeckConfig };

  ui.myHP.textContent = state.myHP; ui.oppHP.textContent = 3;
  ui.gameMsg.textContent = "VS"; ui.gameMsg.style.color = "#e74c3c";
  ui.myField.textContent = "選ぶ"; ui.myField.style.background = "#ecf0f1"; ui.myField.classList.remove("open");
  ui.oppField.textContent = "考え中"; ui.oppField.style.background = "#ecf0f1"; ui.oppField.classList.remove("open");
  ui.unionBtn.textContent = `合体(残2)`; ui.unionBtn.classList.remove("active"); ui.unionBtn.disabled = false;
  document.getElementById("last-card").textContent = "なし"; document.getElementById("opp-blessing-msg").textContent = "";

  ui.activeBlessings.innerHTML = ""; state.blessingCounts = {};
  state.selectedBlessings.forEach(id => {
    state.blessingCounts[id] = BLESSINGS[id].max;
    if(id === 5) return; 
    const btn = document.createElement("button"); btn.className = "blessing-btn-in-game"; btn.dataset.id = id;
    btn.onclick = () => {
      if (state.isProcessing) return;
      if (state.turnBlessing === id) { state.turnBlessing = null; btn.classList.remove("selected"); }
      else { state.turnBlessing = id; ui.activeBlessings.querySelectorAll("button").forEach(b=>b.classList.remove("selected")); btn.classList.add("selected"); }
    };
    ui.activeBlessings.appendChild(btn);
  });
  updateBlessingButtonsUI();
  
  ui.unionBtn.onclick = () => {
    if(state.unionCount <= 0 || state.isProcessing) return;
    state.isUnionMode = !state.isUnionMode;
    ui.unionBtn.classList.toggle("active", state.isUnionMode);
    if(!state.isUnionMode) { state.turnCard1 = null; renderInventoryHand(); } 
  };

  renderInventoryHand();

  if(state.isHost) {
    await setDoc(doc(db, "rooms", state.roomID), {
      [`${state.uid}_hp`]: state.myHP, [`${targetID}_hp`]: 3,
      [`${state.uid}_ready`]: false, [`${targetID}_ready`]: false, turn: 1
    });
  }

  if (listeners.room) listeners.room();
  listeners.room = onSnapshot(doc(db, "rooms", state.roomID), (snap) => {
    if(!snap.exists()) return;
    const data = snap.data();
    
    state.myHP = data[`${state.uid}_hp`]; state.oppHP = data[`${state.targetUID}_hp`];
    ui.myHP.textContent = state.myHP; ui.oppHP.textContent = state.oppHP;
    
    if(data[`${state.targetUID}_ready`] && !data[`${state.uid}_ready`]) {
      ui.oppField.textContent = "セット済"; ui.oppField.style.background = "#34495e"; ui.oppField.style.color = "white";
    }

    if(data[`${state.uid}_ready`] && data[`${state.targetUID}_ready`] && state.isProcessing) {
      resolveTurn演出(data);
    }
  });
};

// ----------------------------------
// 勝敗判定とポップアップ表示
// ----------------------------------
const resolveTurn演出 = (data) => {
  const me = state.uid; const opp = state.targetUID;
  const roomRef = doc(db, "rooms", state.roomID);

  const myB = data[`${me}_blessing`]; const oppB = data[`${opp}_blessing`];
  const oppRawVal = data[`${opp}_card1`] + (data[`${opp}_card2`] || 0); 

  let myVal = data[`${me}_card1`] + (data[`${me}_card2`] || 0);
  let oppVal = oppRawVal;

  if(myB === 9) oppVal = Math.max(0, oppVal - 4); if(oppB === 9) myVal = Math.max(0, myVal - 4);
  if(myB === 0) myVal += 4; if(oppB === 0) oppVal += 4;
  if(myB === 7) myVal += Math.max(0, (data[`${opp}_hp`] - data[`${me}_hp`]) * 2);
  if(oppB === 7) oppVal += Math.max(0, (data[`${me}_hp`] - data[`${opp}_hp`]) * 2);

  const isReverse = (myB === 1 || oppB === 1);
  let result = 0; 
  
  if (myVal === oppVal) {
    result = 0;
  } else {
    const myIsZeroOppIsNine = (myVal === 0 && oppVal === 9);
    const myIsNineOppIsZero = (myVal === 9 && oppVal === 0);
    
    if (myIsZeroOppIsNine) result = isReverse ? 2 : 1;
    else if (myIsNineOppIsZero) result = isReverse ? 1 : 2; 
    else {
      if (!isReverse) result = (myVal > oppVal) ? 1 : 2;
      else result = (myVal < oppVal) ? 1 : 2;
    }
  }

  let myDmg = (result === 2) ? 1 : 0; let oppDmg = (result === 1) ? 1 : 0;
  if(result === 1 && myB === 6) oppDmg = 2; if(result === 2 && oppB === 6) myDmg = 2; 
  if(myB === 4 && result === 2) { myDmg = 0; oppDmg = 1; } if(oppB === 4 && result === 1) { oppDmg = 0; myDmg = 1; } 
  if(myB === 8 && myDmg > 0) myDmg = 0; if(oppB === 8 && oppDmg > 0) oppDmg = 0; 

  let nextMyHP = data[`${me}_hp`] - myDmg + (myB === 3 ? 1 : 0);
  let nextOppHP = data[`${opp}_hp`] - oppDmg + (oppB === 3 ? 1 : 0);

  ui.myField.textContent = myVal; ui.myField.classList.add("open"); ui.myField.style.background = "white";
  ui.oppField.textContent = oppVal; ui.oppField.classList.add("open"); ui.oppField.style.background = "white";
  document.getElementById("opp-blessing-msg").textContent = oppB !== null ? `相手:${BLESSINGS[oppB].name.split('(')[0]}` : "";

  let msg = "", color = "";
  if(result === 1) { msg = "WIN! 🎉"; color = "#f1c40f"; }
  else if(result === 2) { msg = "LOSE... 💦"; color = "#3498db"; }
  else { msg = "DRAW ⚔️"; color = "white"; }
  
  ui.gameMsg.textContent = msg; ui.gameMsg.style.color = color;

  ui.turnResultMsg.textContent = msg;
  ui.turnResultMsg.style.color = color;
  
  let oppValText = `${oppRawVal}`;
  if (oppRawVal !== oppVal) oppValText += ` (補正後: ${oppVal})`;
  ui.turnOppCard.textContent = oppValText;
  ui.turnOppBlessing.textContent = oppB !== null ? BLESSINGS[oppB].name.split('(')[0] : "使用なし"; // 加護の名前だけきれいに表示

  setTimeout(() => {
    ui.turnResultOverlay.style.display = "flex";
  }, 800);

  ui.turnResultOverlay.onclick = async () => {
    ui.turnResultOverlay.style.display = "none";
    ui.turnResultOverlay.onclick = null; 

    if(state.isHost) {
      if(nextMyHP <= 0 || nextOppHP <= 0) {
        await updateDoc(roomRef, { [`${me}_hp`]: nextMyHP, [`${opp}_hp`]: nextOppHP, gameOver: true });
      } else {
        await updateDoc(roomRef, {
          [`${me}_hp`]: nextMyHP, [`${opp}_hp`]: nextOppHP, [`${me}_ready`]: false, [`${opp}_ready`]: false,
          [`${me}_card1`]: null, [`${me}_card2`]: null, [`${me}_blessing`]: null,
          [`${opp}_card1`]: null, [`${opp}_card2`]: null, [`${opp}_blessing`]: null, turn: data.turn + 1
        });
      }
    }

    if(nextMyHP <= 0 || nextOppHP <= 0) {
      if(listeners.room) listeners.room();
      showResult(nextMyHP > nextOppHP);
    } else {
      ui.myField.textContent = "選ぶ"; ui.myField.style.background = "#ecf0f1"; ui.myField.classList.remove("open");
      ui.oppField.textContent = "考え中"; ui.oppField.style.background = "#ecf0f1"; ui.oppField.classList.remove("open");
      document.getElementById("opp-blessing-msg").textContent = "";
      ui.gameMsg.textContent = "VS"; ui.gameMsg.style.color = "#e74c3c";
      state.turnCard1 = null; state.turnCard2 = null; state.turnBlessing = null; state.isProcessing = false;
      renderInventoryHand(); 
    }
  };
};

// ----------------------------------
// リザルト・ポイント処理
// ----------------------------------
const showResult = async (isWin) => {
  screens.game.style.display = "none"; screens.result.style.display = "block";
  
  let finalPoints = state.points;
  let pointChangeMsg = "";
  
  if(isWin) {
    ui.resTitle.textContent = "🏆 勝利！ 🏆"; ui.resTitle.style.color = "#f1c40f";
    const gain = (state.points === 0) ? 10 : state.betPts; 
    finalPoints += gain; pointChangeMsg = `ポイント獲得: +${gain} pt`;
  } else {
    ui.resTitle.textContent = "💀 敗北... 💀"; ui.resTitle.style.color = "#e74c3c";
    finalPoints = Math.max(0, finalPoints - state.betPts); pointChangeMsg = `ポイント喪失: -${state.betPts} pt`;
  }

  ui.resPoint.textContent = `${pointChangeMsg} (現在: ${finalPoints} pt)`;
  await updateDoc(doc(db, "users", state.uid), { points: finalPoints, targetID: null });
  state.points = finalPoints; 
};

ui.backBtn.addEventListener("click", () => { init(); });

init();
