import { db } from "./firebase-config.js";
import { doc, setDoc, getDoc, updateDoc, onSnapshot, collection, query, orderBy, limit, getDocs } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// --- データの定義 ---
const BLESSINGS = {
  0: { name: "巨人の剛腕(+4)", max: 1 }, 1: { name: "あべこべの世界", max: 5 },
  2: { name: "混沌の儀式", max: 3 }, 3: { name: "再生の祈り", max: 2 },
  4: { name: "全反射", max: 1 }, 5: { name: "不屈の魂(初期HP+2)", max: 1 },
  6: { name: "審判の雷", max: 1 }, 7: { name: "復讐の誓い", max: 1 },
  8: { name: "聖なる盾", max: 1 }, 9: { name: "重力の呪縛(-4)", max: 1 }
};

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

// --- グローバル変数 ---
let state = {
  uid: "", points: 0, betPts: 0, target: "", roomID: "", isHost: false,
  myDeck: [], myHand: [], selectedBlessings: [], blessingCounts: {},
  myHP: 3, oppHP: 3, isUnionMode: false, unionCount: 2, lastCard: null,
  turnCard1: null, turnCard2: null, turnBlessing: null, isProcessing: false
};
let listeners = { opponent: null, room: null };

// --- ロビー＆準備処理 ---
const formatUID = (uid) => uid ? `${uid.slice(0,3)}-${uid.slice(3,6)}-${uid.slice(6,9)}` : "";
const generateUID = () => Math.floor(100000000 + Math.random() * 900000000).toString();

async function loadRanking() {
  ui.ranking.innerHTML = "";
  const q = query(collection(db, "users"), orderBy("points", "desc"), limit(5));
  const snap = await getDocs(q);
  snap.forEach(doc => {
    const li = document.createElement("li");
    li.textContent = `ID: ${formatUID(doc.id)} - ${doc.data().points} pt`;
    ui.ranking.appendChild(li);
  });
}

function renderBlessingSetup() {
  ui.blessings.innerHTML = "";
  Object.keys(BLESSINGS).forEach(id => {
    const label = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.value = id;
    cb.onchange = () => {
      const checked = document.querySelectorAll('#blessing-container input:checked');
      if(checked.length > 3) cb.checked = false; // 3つまで
    };
    label.appendChild(cb);
    label.append(` ${BLESSINGS[id].name}`);
    ui.blessings.appendChild(label);
  });
}

async function init() {
  state.uid = localStorage.getItem("myUID") || generateUID();
  localStorage.setItem("myUID", state.uid);

  const userSnap = await getDoc(doc(db, "users", state.uid));
  if (!userSnap.exists()) {
    state.points = 100;
    await setDoc(doc(db, "users", state.uid), { points: 100, targetID: null });
  } else {
    state.points = userSnap.data().points;
  }

  // 賭けポイント計算 (5%切り上げ)
  state.betPts = Math.ceil(state.points * 0.05);

  ui.myId.textContent = formatUID(state.uid);
  ui.points.textContent = state.points;
  ui.bet.textContent = state.betPts;
  
  screens.lobby.style.display = "block";
  screens.game.style.display = "none";
  screens.result.style.display = "none";
  ui.status.textContent = "";
  ui.matchBtn.disabled = false;

  loadRanking();
  renderBlessingSetup();
}

ui.matchBtn.addEventListener("click", async () => {
  const targetID = ui.targetInput.value.replace(/[^0-9]/g, "");
  if (targetID.length !== 9 || targetID === state.uid) return alert("正しい9桁のIDを入力してください");

  // 選んだ加護を取得
  const checked = document.querySelectorAll('#blessing-container input:checked');
  state.selectedBlessings = Array.from(checked).map(cb => parseInt(cb.value));
  if(state.selectedBlessings.length === 0) return alert("加護を1つ以上選んでください！");

  ui.matchBtn.disabled = true;
  ui.status.textContent = "相手を待機中...";

  await updateDoc(doc(db, "users", state.uid), { targetID: targetID });

  if (listeners.opponent) listeners.opponent();
  listeners.opponent = onSnapshot(doc(db, "users", targetID), (snap) => {
    if (snap.exists() && snap.data().targetID === state.uid) {
      ui.status.textContent = "マッチング成功！";
      listeners.opponent();
      setTimeout(() => startGame(targetID), 1000);
    }
  });
});

// --- ゲーム本編 ---
const generateDeck = () => {
  const pool = [0,...Array(16).fill(1),...Array(8).fill(2),...Array(5).fill(3),...Array(4).fill(4),...Array(3).fill(5),...Array(2).fill(6),...Array(2).fill(7),...Array(2).fill(8),9];
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool.slice(0, 30);
};

const setupGameUI = () => {
  state.blessingCounts = {};
  ui.activeBlessings.innerHTML = "";
  state.selectedBlessings.forEach(id => {
    state.blessingCounts[id] = BLESSINGS[id].max;
    if(id === 5) return; // 不屈の魂は開始時のみ発動
    const btn = document.createElement("button");
    btn.className = "blessing-btn";
    btn.textContent = `${BLESSINGS[id].name} (${state.blessingCounts[id]})`;
    btn.onclick = () => {
      if(state.turnBlessing === id) { state.turnBlessing = null; btn.classList.remove("selected"); }
      else { state.turnBlessing = id; document.querySelectorAll(".blessing-btn").forEach(b=>b.classList.remove("selected")); btn.classList.add("selected"); }
    };
    ui.activeBlessings.appendChild(btn);
  });
  
  ui.unionBtn.onclick = () => {
    if(state.unionCount <= 0) return;
    state.isUnionMode = !state.isUnionMode;
    ui.unionBtn.classList.toggle("active", state.isUnionMode);
  };
};

const checkPlusMinus3 = (num) => {
  if (state.lastCard === null) return true;
  // 手札に条件を満たすカードがない場合は免除
  const hasValid = state.myHand.some(c => Math.abs(c - state.lastCard) >= 3);
  if (!hasValid) return true; 
  return Math.abs(num - state.lastCard) >= 3;
};

const renderHand = () => {
  ui.hand.innerHTML = "";
  state.myHand.forEach((num, idx) => {
    const card = document.createElement("div");
    card.className = "hand-card";
    card.textContent = num;
    if(!checkPlusMinus3(num)) card.classList.add("disabled");

    card.onclick = async () => {
      if(state.isProcessing || !checkPlusMinus3(num)) return;
      
      if(state.isUnionMode) {
        if(state.turnCard1 === null) { state.turnCard1 = num; state.myHand.splice(idx,1); renderHand(); return; }
        state.turnCard2 = num; state.myHand.splice(idx,1);
        state.unionCount--; state.isUnionMode = false; ui.unionBtn.textContent = `合体: 残${state.unionCount}回`;
      } else {
        state.turnCard1 = num; state.myHand.splice(idx,1);
      }
      
      state.isProcessing = true;
      ui.myField.textContent = "セット済";
      ui.myField.style.background = "#34495e";
      
      // 混沌の儀式(2)の特殊処理
      if(state.turnBlessing === 2) { state.turnCard1 = Math.floor(Math.random()*10); state.myHand.push(num); }

      await updateDoc(doc(db, "rooms", state.roomID), {
        [`${state.uid}_ready`]: true,
        [`${state.uid}_card1`]: state.turnCard1,
        [`${state.uid}_card2`]: state.turnCard2,
        [`${state.uid}_blessing`]: state.turnBlessing
      });
      state.lastCard = state.turnCard2 !== null ? state.turnCard1 + state.turnCard2 : state.turnCard1;
      document.getElementById("last-card").textContent = state.lastCard;
      
      if(state.turnBlessing !== null) {
        state.blessingCounts[state.turnBlessing]--;
        if(state.blessingCounts[state.turnBlessing]<=0) document.querySelectorAll(".blessing-btn").forEach(b => { if(b.textContent.includes(BLESSINGS[state.turnBlessing].name)) b.disabled = true; });
        state.turnBlessing = null;
        document.querySelectorAll(".blessing-btn").forEach(b=>b.classList.remove("selected"));
      }
    };
    ui.hand.appendChild(card);
  });
};

const startGame = async (targetID) => {
  screens.lobby.style.display = "none"; screens.game.style.display = "flex";
  state.target = targetID; state.isHost = state.uid < targetID;
  state.roomID = state.isHost ? `${state.uid}_${targetID}` : `${targetID}_${state.uid}`;
  
  state.myDeck = generateDeck(); state.myHand = state.myDeck.splice(0,5);
  state.myHP = state.selectedBlessings.includes(5) ? 5 : 3; // 不屈の魂
  state.unionCount = 2; state.lastCard = null; state.isProcessing = false;
  state.turnCard1 = null; state.turnCard2 = null; state.turnBlessing = null;

  setupGameUI(); renderHand();

  if(state.isHost) {
    await setDoc(doc(db, "rooms", state.roomID), {
      [`${state.uid}_hp`]: state.myHP, [`${targetID}_hp`]: 3,
      [`${state.uid}_ready`]: false, [`${targetID}_ready`]: false
    });
  }

  listeners.room = onSnapshot(doc(db, "rooms", state.roomID), (snap) => {
    if(!snap.exists()) return;
    const data = snap.data();
    ui.myHP.textContent = data[`${state.uid}_hp`];
    ui.oppHP.textContent = data[`${state.target}_hp`];
    
    if(data[`${state.target}_ready`] && !data[`${state.uid}_ready`]) ui.oppField.textContent = "セット済";
    
    // 両者揃ったらバトル計算
    if(data[`${state.uid}_ready`] && data[`${state.target}_ready`] && state.isProcessing) {
      resolveTurn(data);
    }
  });
};

// --- 勝敗判定と加護の効果計算 ---
const resolveTurn = (data) => {
  const me = state.uid; const opp = state.target;
  let myVal = data[`${me}_card1`] + (data[`${me}_card2`] || 0);
  let oppVal = data[`${opp}_card1`] + (data[`${opp}_card2`] || 0);
  let myB = data[`${me}_blessing`]; let oppB = data[`${opp}_blessing`];
  let myHpNow = data[`${me}_hp`]; let oppHpNow = data[`${opp}_hp`];

  // 1. 弱体化(9), 強化(0, 7)
  if(myB === 9) oppVal = Math.max(0, oppVal - 4); if(oppB === 9) myVal = Math.max(0, myVal - 4);
  if(myB === 0) myVal += 4; if(oppB === 0) oppVal += 4;
  if(myB === 7) myVal += Math.max(0, (oppHpNow - myHpNow) * 2);
  if(oppB === 7) oppVal += Math.max(0, (myHpNow - oppHpNow) * 2);

  // 2. 勝敗判定(あべこべ(1)考慮)
  let isReverse = (myB === 1 || oppB === 1);
  let myWin = isReverse ? (myVal < oppVal) : (myVal > oppVal);
  let oppWin = isReverse ? (myVal > oppVal) : (myVal < oppVal);

  // 3. ダメージ計算(6, 4, 8, 3)
  let myDmg = oppWin ? 1 : 0; let oppDmg = myWin ? 1 : 0;
  if(myWin && myB === 6) oppDmg = 2; if(oppWin && oppB === 6) myDmg = 2; // 雷
  if(myB === 4 && oppWin) { myDmg = 0; oppDmg = 1; } if(oppB === 4 && myWin) { oppDmg = 0; myDmg = 1; } // 反射
  if(myB === 8 && myDmg > 0) myDmg = 0; if(oppB === 8 && oppDmg > 0) oppDmg = 0; // 盾

  let nextMyHp = myHpNow - myDmg + (myB === 3 ? 1 : 0);
  let nextOppHp = oppHpNow - oppDmg + (oppB === 3 ? 1 : 0);

  // 演出表示
  ui.myField.textContent = myVal; ui.myField.style.background = "white";
  ui.oppField.textContent = oppVal; ui.oppField.style.background = "white";
  document.getElementById("opp-blessing-msg").textContent = oppB !== null ? `相手使用: ${BLESSINGS[oppB].name}` : "";
  
  if(myWin) ui.gameMsg.textContent = "WIN! 🎉";
  else if(oppWin) ui.gameMsg.textContent = "LOSE... 💦";
  else ui.gameMsg.textContent = "DRAW ⚔️";

  // 終了判定
  setTimeout(async () => {
    if(nextMyHp <= 0 || nextOppHp <= 0) {
      if(listeners.room) listeners.room();
      showResult(nextMyHp > 0);
    } else {
      if(state.isHost) {
        await updateDoc(doc(db, "rooms", state.roomID), {
          [`${me}_hp`]: nextMyHp, [`${opp}_hp`]: nextOppHp,
          [`${me}_ready`]: false, [`${opp}_ready`]: false,
          [`${me}_card1`]: null, [`${me}_card2`]: null, [`${me}_blessing`]: null,
          [`${opp}_card1`]: null, [`${opp}_card2`]: null, [`${opp}_blessing`]: null
        });
      }
      ui.myField.textContent = "選ぶ"; ui.myField.style.background = "#ecf0f1";
      ui.oppField.textContent = "考え中"; document.getElementById("opp-blessing-msg").textContent = "";
      ui.gameMsg.textContent = "VS";
      if(state.myDeck.length > 0 && state.myHand.length < 8) state.myHand.push(state.myDeck.shift());
      state.turnCard1 = null; state.turnCard2 = null; state.isProcessing = false;
      renderHand();
    }
  }, 3000);
};

// --- リザルト処理とポイント更新 ---
const showResult = async (isWin) => {
  screens.game.style.display = "none"; screens.result.style.display = "block";
  
  let resultPts = state.points;
  if(isWin) {
    ui.resTitle.textContent = "🏆 勝利！ 🏆";
    ui.resTitle.style.color = "#f1c40f";
    resultPts += (state.points === 0 ? 10 : state.betPts); // 破産救済
    ui.resPoint.textContent = `ポイント獲得！: 現在 ${resultPts} pt`;
  } else {
    ui.resTitle.textContent = "💀 敗北... 💀";
    ui.resTitle.style.color = "#e74c3c";
    resultPts -= state.betPts;
    ui.resPoint.textContent = `ポイント喪失...: 現在 ${resultPts} pt`;
  }

  await updateDoc(doc(db, "users", state.uid), { points: resultPts, targetID: null });
};

ui.backBtn.addEventListener("click", () => {
  init(); // ロビーに戻って再読み込み
});

// プログラム起動
init();
