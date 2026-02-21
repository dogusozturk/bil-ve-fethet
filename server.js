const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(path.join(__dirname, 'public')));

/* ═══════════════════ SORU BANKASI ═══════════════════ */
const numericalQ = JSON.parse(fs.readFileSync(path.join(__dirname, 'questions', 'numerical.json'), 'utf8'));
const multipleQ  = JSON.parse(fs.readFileSync(path.join(__dirname, 'questions', 'multiple.json'), 'utf8'));
const { REGIONS } = require('./public/turkey-map.js');

/* ═══════════════════ SABİTLER ═══════════════════ */
const C = {
    EXPANSION_ROUNDS: 4,
    BATTLE_ROUNDS: 6,
    CASTLE_HP: 3,
    EXPANSION_TIME: 15,       // tahmin süresi (sn)
    TERRITORY_SELECT_TIME: 10,
    BATTLE_TIME: 20,
    ATTACK_SELECT_TIME: 15,
    TIEBREAKER_TIME: 15,
    SHRINK_EVERY: 3,
    SCORE_BASE: 1000,
    SCORE_REGION: 200,
    SCORE_CONQUEST: 400,
    SCORE_DEFENSE: 100,
    COLORS: [
        '#e74c3c','#3b82f6','#10b981','#f59e0b','#8b5cf6','#ec4899',
        '#06b6d4','#84cc16','#f97316','#6366f1','#14b8a6','#ef4444',
        '#a855f7','#22c55e','#0ea5e9','#eab308'
    ]
};

/* ═══════════════════ ODA YÖNETİMİ ═══════════════════ */
const rooms = new Map();

function genCode(){
    let c; do{ c = Math.random().toString(36).substring(2,8).toUpperCase(); }while(rooms.has(c));
    return c;
}

function createRoom(code, hostPlayer){
    return {
        code, players: [hostPlayer], state:'lobby', phase:null,
        map:[], expansionRound:0, battleRound:0, shrinkLevel:0,
        currentQuestion:null, currentAnswers:{}, selectionQueue:[],
        selectionIndex:0, selectingPlayer:null,
        currentAttacks:{}, pendingBattles:[], currentBattleIndex:0,
        battleAnswers:{}, currentBattleQuestion:null,
        tiebreakerQuestion:null, tiebreakerAnswers:{},
        questionTimer:null, selectionTimer:null, attackTimer:null,
        battleQuestionTimer:null, tiebreakerTimer:null,
        questionStartTime:0, battleQuestionStart:0, tiebreakerStartTime:0
    };
}

/* ═══════════════════ HARİTA ═══════════════════ */
function buildMap(){
    return REGIONS.map(r=>({
        id:r.code, name:r.name, x:r.x, y:r.y,
        neighbors:[...r.neighbors], path:r.path,
        owner:null, hasBase:false, baseHp:0, burned:false
    }));
}

function emptyRegions(room){ return room.map.filter(r=>!r.owner && !r.burned); }
function regionCount(room,pid){ return room.map.filter(r=>r.owner===pid && !r.burned).length; }

function attackable(room, pid){
    const my = room.map.filter(r=>r.owner===pid && !r.burned);
    const s = new Set();
    for(const r of my) for(const nid of r.neighbors){
        const nr = room.map.find(x=>x.id===nid);
        if(nr && !nr.burned && nr.owner && nr.owner!==pid) s.add(nid);
    }
    return [...s];
}

function selectable(room, pid){
    const my = room.map.filter(r=>r.owner===pid && !r.burned);
    if(!my.length) return emptyRegions(room).map(r=>r.id);
    const s = new Set();
    for(const r of my) for(const nid of r.neighbors){
        const nr = room.map.find(x=>x.id===nid);
        if(nr && !nr.burned && !nr.owner) s.add(nid);
    }
    return s.size ? [...s] : emptyRegions(room).map(r=>r.id);
}

function alive(room){ return room.players.filter(p=>!p.eliminated); }

function score(room,p){
    return C.SCORE_BASE + regionCount(room,p.id)*C.SCORE_REGION + (p.conquestScore||0) + (p.defenseScore||0);
}

function safeList(room){
    return room.players.map(p=>({
        id:p.id, name:p.name, color:p.color, ready:p.ready,
        isHost:p.isHost, eliminated:!!p.eliminated, isBot:!!p.isBot,
        score: score(room,p),
        territories: regionCount(room,p.id),
        powerUps: p.powerUps||{},
        conquestScore: p.conquestScore||0,
        defenseScore: p.defenseScore||0,
        regionScore: regionCount(room,p.id)*C.SCORE_REGION
    }));
}

function findSocket(room, pid){
    for(const [,s] of io.sockets.sockets)
        if(s.playerId===pid && s.roomCode===room.code) return s;
    return null;
}

/* ═══════════════════ KALE YERLEŞTİRME ═══════════════════ */
function placeCastles(room){
    const ps = room.players;
    const usedIds = new Set();
    const assigns = [];
    const available = room.map.filter(r=>!r.burned);

    // Harita merkezini hesapla
    const cx = available.reduce((s,r)=>s+r.x,0)/available.length;
    const cy = available.reduce((s,r)=>s+r.y,0)/available.length;

    // Tum mesafeleri merkeze gore hesapla
    const maxDist = Math.max(...available.map(r=>Math.hypot(r.x-cx, r.y-cy)));
    const minAcceptable = maxDist * 0.2; // Merkeze cok yakin olmasin
    const maxAcceptable = maxDist * 0.75; // Cok kenarda da olmasin

    // Orta bolgeden baslat (ne cok merkez, ne cok kenar)
    const midRange = available.filter(r=>{
        const d = Math.hypot(r.x-cx, r.y-cy);
        return d >= minAcceptable && d <= maxAcceptable;
    });
    const startPool = midRange.length > 0 ? midRange : available;
    const first = startPool[Math.floor(Math.random()*startPool.length)];
    usedIds.add(first.id); assigns.push({playerId:ps[0].id, regionId:first.id});

    // Sonraki oyuncular: diger kalelere orta mesafede (ne cok yakin, ne cok uzak)
    for(let i=1;i<ps.length;i++){
        let bestId=null, bestScore=-Infinity;
        // Ideal mesafe: mevcut kalelere en az 80px, en cok 350px
        const idealMin = 80;
        const idealMax = 350;
        const idealMid = (idealMin + idealMax) / 2;

        for(const r of available){
            if(usedIds.has(r.id)) continue;
            let minD=Infinity;
            for(const uid of usedIds){
                const ur=room.map.find(x=>x.id===uid);
                if(!ur) continue;
                const dx=r.x-ur.x, dy=r.y-ur.y;
                minD=Math.min(minD, Math.sqrt(dx*dx+dy*dy));
            }
            // Cok yakin olan bolgeleri ele (minimum 60px)
            if(minD < 60) continue;
            // Skor: ideal orta mesafeye yakinlik
            const distFromIdeal = Math.abs(minD - idealMid);
            const score = -distFromIdeal + (minD >= idealMin && minD <= idealMax ? 100 : 0);
            if(score > bestScore){ bestScore=score; bestId=r.id; }
        }
        // Fallback: hic bulunamadiysa en uzak bolgey al
        if(bestId===null){
            let fd=-1;
            for(const r of available){
                if(usedIds.has(r.id)) continue;
                let minD=Infinity;
                for(const uid of usedIds){
                    const ur=room.map.find(x=>x.id===uid);
                    if(!ur) continue;
                    minD=Math.min(minD, Math.hypot(r.x-ur.x, r.y-ur.y));
                }
                if(minD>fd){fd=minD; bestId=r.id;}
            }
        }
        if(bestId!==null){ usedIds.add(bestId); assigns.push({playerId:ps[i].id, regionId:bestId}); }
    }
    for(const a of assigns){
        const r=room.map.find(x=>x.id===a.regionId);
        if(r){ r.owner=a.playerId; r.hasBase=true; r.baseHp=C.CASTLE_HP; }
    }
    return assigns;
}

/* ═══════════════════ CHECK HELPERS ═══════════════════ */
function checkAllAnswered(room){
    if(Object.keys(room.currentAnswers).length >= alive(room).length){
        clearTimeout(room.questionTimer);
        resolveExpansion(room.code);
    }
}
function checkAttacks(room){
    if(Object.keys(room.currentAttacks).length >= alive(room).length){
        clearTimeout(room.attackTimer);
        resolveAttacks(room.code);
    }
}
function checkBattle(room){
    const b=room.pendingBattles[room.currentBattleIndex];
    if(b && room.battleAnswers[b.attackerId] && room.battleAnswers[b.defenderId]){
        clearTimeout(room.battleQuestionTimer);
        resolveBattle(room.code);
    }
}
function checkTiebreaker(room){
    const b=room.pendingBattles[room.currentBattleIndex];
    if(b && room.tiebreakerAnswers[b.attackerId] && room.tiebreakerAnswers[b.defenderId]){
        clearTimeout(room.tiebreakerTimer);
        resolveTiebreakerQ(room.code);
    }
}

/* ═══════════════════ OYUN BAŞLAT ═══════════════════ */
function startGame(code){
    const room=rooms.get(code); if(!room) return;
    room.state='playing'; room.phase='setup';
    room.expansionRound=0; room.battleRound=0; room.shrinkLevel=0;
    room.map=buildMap();
    room.players.forEach(p=>{
        p.eliminated=false; p.conquestScore=0; p.defenseScore=0;
        p.powerUps={fiftyFifty:1,extraTime:1,spy:1};
    });
    const castles=placeCastles(room);

    io.to(code).emit('gameStarted',{
        map:room.map, players:safeList(room), castleAssignments:castles,
        totalExpansionRounds:C.EXPANSION_ROUNDS, totalBattleRounds:C.BATTLE_ROUNDS
    });

    // Castle anim (~1.3s * player count) + 10s countdown + buffer
    const castleDelay = Math.max(16000, castles.length * 1300 + 12000);
    setTimeout(()=>startExpansion(code), castleDelay);
}

/* ═══════════════════ GENİŞLEME ═══════════════════ */
function startExpansion(code){
    const room=rooms.get(code); if(!room||room.state!=='playing') return;
    room.expansionRound++;
    if(room.expansionRound > C.EXPANSION_ROUNDS){
        io.to(code).emit('phaseChange',{phase:'battle'});
        setTimeout(()=>startBattle(code), 2500);
        return;
    }
    room.phase='expansion'; room.currentAnswers={};
    const q = numericalQ[Math.floor(Math.random()*numericalQ.length)];
    room.currentQuestion=q; room.questionStartTime=Date.now();

    io.to(code).emit('expansionQuestion',{
        round:room.expansionRound, totalRounds:C.EXPANSION_ROUNDS,
        question:q.q, unit:q.unit||'', timeLimit:C.EXPANSION_TIME
    });

    room.questionTimer=setTimeout(()=>resolveExpansion(code), (C.EXPANSION_TIME+1)*1000);
}

function resolveExpansion(code){
    const room=rooms.get(code); if(!room) return;
    clearTimeout(room.questionTimer);
    const correct=room.currentQuestion.a;
    const ap=alive(room);

    const results=ap.map(p=>{
        const a=room.currentAnswers[p.id];
        if(!a) return {playerId:p.id,name:p.name,color:p.color,diff:Infinity,time:Infinity,answer:null};
        return {playerId:p.id,name:p.name,color:p.color,diff:Math.abs(a.value-correct),time:a.time,answer:a.value};
    }).sort((a,b)=> a.diff!==b.diff ? a.diff-b.diff : a.time-b.time);

    const maxDiff=Math.max(...results.filter(r=>r.diff!==Infinity).map(r=>r.diff),1);
    const dartResults=results.map((r,i)=>({
        ...r, rank:i+1,
        dartDistance: r.diff===Infinity ? 1 : Math.min(r.diff/(maxDiff*1.2),1),
        territoryPicks: i===0?2:(i===1?1:0)
    }));

    // Seçim kuyruğu: 1.→2 seçim, 2.→1 seçim
    room.selectionQueue=[];
    if(dartResults.length>0){ room.selectionQueue.push(dartResults[0].playerId, dartResults[0].playerId); }
    if(dartResults.length>1){ room.selectionQueue.push(dartResults[1].playerId); }
    room.selectionIndex=0;

    io.to(code).emit('expansionResults',{
        correctAnswer:correct, unit:room.currentQuestion.unit||'', rankings:dartResults
    });

    setTimeout(()=>startSelection(code), 5500);
}

function startSelection(code){
    const room=rooms.get(code); if(!room) return;
    if(room.selectionIndex>=room.selectionQueue.length || !emptyRegions(room).length){
        setTimeout(()=>startExpansion(code),800);
        return;
    }
    const pid=room.selectionQueue[room.selectionIndex];
    const p=room.players.find(x=>x.id===pid);
    if(!p||p.eliminated){ room.selectionIndex++; startSelection(code); return; }

    room.selectingPlayer=pid;
    const sel=selectable(room,pid);
    const left=room.selectionQueue.filter((id,idx)=>idx>=room.selectionIndex && id===pid).length;

    io.to(code).emit('selectTerritoryTurn',{
        playerId:pid, playerName:p.name, playerColor:p.color,
        selectableRegions:sel, timeLimit:C.TERRITORY_SELECT_TIME,
        picksLeft:left
    });

    room.selectionTimer=setTimeout(()=>{
        if(room.selectingPlayer===pid && sel.length>0)
            handleSelect(code,pid,sel[Math.floor(Math.random()*sel.length)]);
    }, (C.TERRITORY_SELECT_TIME+1)*1000);
}

function handleSelect(code,pid,rid){
    const room=rooms.get(code); if(!room||room.selectingPlayer!==pid) return;
    clearTimeout(room.selectionTimer);
    const r=room.map.find(x=>x.id===rid);
    if(!r||r.burned||r.owner) return;
    r.owner=pid;

    io.to(code).emit('territorySelected',{
        playerId:pid, regionId:rid, regionName:r.name,
        map:room.map, players:safeList(room)
    });

    room.selectionIndex++; room.selectingPlayer=null;
    setTimeout(()=>startSelection(code), 1200);
}

/* ═══════════════════ SAVAŞ ═══════════════════ */
function startBattle(code){
    const room=rooms.get(code); if(!room) return;
    room.battleRound++;

    // Daralma
    if(room.battleRound>1 && (room.battleRound-1)%C.SHRINK_EVERY===0){
        shrinkMap(code); return;
    }
    if(room.battleRound>C.BATTLE_ROUNDS || alive(room).length<=1){
        endGame(code); return;
    }

    room.phase='battle'; room.currentAttacks={};
    const ap=alive(room);
    const opts={};
    for(const p of ap) opts[p.id]=attackable(room,p.id);

    io.to(code).emit('battlePhase',{
        round:room.battleRound, totalRounds:C.BATTLE_ROUNDS,
        attackOptions:opts, players:safeList(room), map:room.map,
        timeLimit:C.ATTACK_SELECT_TIME
    });

    room.attackTimer=setTimeout(()=>{
        alive(room).forEach(p=>{ if(!room.currentAttacks[p.id]) room.currentAttacks[p.id]=-1; });
        resolveAttacks(code);
    }, (C.ATTACK_SELECT_TIME+1)*1000);
}

function resolveAttacks(code){
    const room=rooms.get(code); if(!room) return;
    clearTimeout(room.attackTimer);
    const battles=[];
    for(const [aid,trid] of Object.entries(room.currentAttacks)){
        if(trid===-1||trid===null) continue;
        const tr=room.map.find(r=>r.id===trid);
        if(!tr||!tr.owner) continue;
        const att=room.players.find(p=>p.id===aid);
        const def=room.players.find(p=>p.id===tr.owner);
        if(!att||!def||att.eliminated||def.eliminated) continue;
        battles.push({
            attackerId:aid, defenderId:tr.owner, targetRegionId:trid,
            attackerName:att.name, defenderName:def.name,
            attackerColor:att.color, defenderColor:def.color,
            targetRegionName:tr.name
        });
    }
    if(!battles.length){ setTimeout(()=>startBattle(code),1500); return; }
    room.pendingBattles=battles; room.currentBattleIndex=0;
    nextBattle(code);
}

function nextBattle(code){
    const room=rooms.get(code); if(!room) return;
    if(room.currentBattleIndex>=room.pendingBattles.length){
        const ap=alive(room);
        if(ap.length<=1) endGame(code);
        else setTimeout(()=>startBattle(code),2000);
        return;
    }
    const b=room.pendingBattles[room.currentBattleIndex];
    room.battleAnswers={};
    const q=multipleQ[Math.floor(Math.random()*multipleQ.length)];
    room.currentBattleQuestion=q; room.battleQuestionStart=Date.now();

    io.to(code).emit('battleQuestion',{
        battle:b, question:q.q, options:[...q.o], timeLimit:C.BATTLE_TIME
    });

    room.battleQuestionTimer=setTimeout(()=>resolveBattle(code), (C.BATTLE_TIME+1)*1000);
}

function resolveBattle(code){
    const room=rooms.get(code); if(!room) return;
    clearTimeout(room.battleQuestionTimer);
    const b=room.pendingBattles[room.currentBattleIndex];
    const q=room.currentBattleQuestion;
    const aA=room.battleAnswers[b.attackerId];
    const dA=room.battleAnswers[b.defenderId];
    const aC=aA && aA.answer===q.a;
    const dC=dA && dA.answer===q.a;

    // Önce cevapları göster (kim ne seçti)
    io.to(code).emit('battleAnswerReveal',{
        battle:b,
        correctIndex: q.a,
        attackerAnswer: aA ? aA.answer : -1,
        defenderAnswer: dA ? dA.answer : -1,
        attackerColor: b.attackerColor,
        defenderColor: b.defenderColor,
        attackerName: b.attackerName,
        defenderName: b.defenderName
    });

    // 3 saniye bekle, sonra sonucu işle
    setTimeout(()=>{
        if(aC && dC){ startTiebreakerQ(code); return; }

        let winner=null, reason='';
        if(aC){ winner=b.attackerId; reason='attacker_correct'; }
        else if(dC){ winner=b.defenderId; reason='defender_correct'; }
        else{ winner=null; reason='both_wrong'; }

        applyBattle(code, winner, reason);
    }, 3000);
}

function startTiebreakerQ(code){
    const room=rooms.get(code); if(!room) return;
    const b=room.pendingBattles[room.currentBattleIndex];
    room.tiebreakerAnswers={};
    const q=numericalQ[Math.floor(Math.random()*numericalQ.length)];
    room.tiebreakerQuestion=q; room.tiebreakerStartTime=Date.now();

    io.to(code).emit('tiebreakerQuestion',{
        battle:b, question:q.q, unit:q.unit||'', timeLimit:C.TIEBREAKER_TIME
    });

    room.tiebreakerTimer=setTimeout(()=>resolveTiebreakerQ(code), (C.TIEBREAKER_TIME+1)*1000);
}

function resolveTiebreakerQ(code){
    const room=rooms.get(code); if(!room) return;
    clearTimeout(room.tiebreakerTimer);
    const b=room.pendingBattles[room.currentBattleIndex];
    const correct=room.tiebreakerQuestion.a;
    const aA=room.tiebreakerAnswers[b.attackerId];
    const dA=room.tiebreakerAnswers[b.defenderId];
    const aD=aA?Math.abs(aA.value-correct):Infinity;
    const dD=dA?Math.abs(dA.value-correct):Infinity;

    let winner,reason;
    if(aD<dD){ winner=b.attackerId; reason='tiebreaker_closer'; }
    else if(dD<aD){ winner=b.defenderId; reason='tiebreaker_closer'; }
    else{
        const aT=aA?aA.time:Infinity, dT=dA?dA.time:Infinity;
        winner = aT<=dT ? b.attackerId : b.defenderId;
        reason='tiebreaker_faster';
    }

    io.to(code).emit('tiebreakerResult',{
        battle:b, correctAnswer:correct, unit:room.tiebreakerQuestion.unit||'',
        attackerAnswer:aA?aA.value:null, defenderAnswer:dA?dA.value:null,
        attackerDiff:aD===Infinity?null:aD, defenderDiff:dD===Infinity?null:dD, winner
    });

    setTimeout(()=>applyBattle(code, winner, reason), 3500);
}

function applyBattle(code, winner, reason){
    const room=rooms.get(code); if(!room) return;
    const b=room.pendingBattles[room.currentBattleIndex];
    const q=room.currentBattleQuestion;
    const tr=room.map.find(r=>r.id===b.targetRegionId);
    let eliminated=null;

    if(winner===b.attackerId && tr){
        const aP=room.players.find(p=>p.id===b.attackerId);
        if(aP) aP.conquestScore+=C.SCORE_CONQUEST;
        if(tr.hasBase){
            tr.baseHp--;
            if(tr.baseHp<=0){
                tr.hasBase=false; tr.owner=winner;
                const dBases=room.map.filter(r=>r.owner===b.defenderId && r.hasBase && !r.burned);
                if(!dBases.length){
                    room.map.forEach(r=>{ if(r.owner===b.defenderId) r.owner=winner; });
                    const dP=room.players.find(p=>p.id===b.defenderId);
                    if(dP){ dP.eliminated=true; eliminated=b.defenderId; }
                }
            }
        } else { tr.owner=winner; }
    } else if(winner===b.defenderId){
        const dP=room.players.find(p=>p.id===b.defenderId);
        if(dP) dP.defenseScore+=C.SCORE_DEFENSE;
    }

    io.to(code).emit('battleResult',{
        battle:b, winner, reason,
        correctAnswer:q.a, correctText:q.o[q.a],
        attackerAnswer: room.battleAnswers[b.attackerId]?.answer??null,
        defenderAnswer: room.battleAnswers[b.defenderId]?.answer??null,
        map:room.map, players:safeList(room), eliminated,
        targetRegion: tr ? {id:tr.id,name:tr.name,hasBase:tr.hasBase,baseHp:tr.baseHp} : null
    });

    room.currentBattleIndex++;
    setTimeout(()=>nextBattle(code), 4000);
}

/* ═══════════════════ HARİTA DARALMASI ═══════════════════ */
function shrinkMap(code){
    const room=rooms.get(code); if(!room) return;
    room.shrinkLevel++;
    const cx=500, cy=245;
    const dists=room.map.filter(r=>!r.burned)
        .map(r=>({id:r.id, d:Math.hypot(r.x-cx, r.y-cy)}))
        .sort((a,b)=>b.d-a.d);
    const burn=Math.max(2, Math.floor(dists.length*0.2));
    const burned=[];
    for(let i=0;i<burn&&i<dists.length;i++){
        const r=room.map.find(x=>x.id===dists[i].id);
        if(!r||r.burned) continue;
        r.burned=true; burned.push(r.id);
        if(r.hasBase && r.owner){
            const own=room.map.filter(x=>x.owner===r.owner && !x.burned && x.id!==r.id);
            if(own.length){
                own.sort((a,b)=>Math.hypot(a.x-cx,a.y-cy)-Math.hypot(b.x-cx,b.y-cy));
                own[0].hasBase=true; own[0].baseHp=r.baseHp;
            } else {
                const p=room.players.find(x=>x.id===r.owner);
                if(p) p.eliminated=true;
            }
            r.hasBase=false;
        }
        r.owner=null;
    }
    room.players.forEach(p=>{
        if(!p.eliminated && !room.map.some(r=>r.owner===p.id && !r.burned)) p.eliminated=true;
    });

    io.to(code).emit('mapShrink',{burnedRegions:burned, shrinkLevel:room.shrinkLevel, map:room.map, players:safeList(room)});

    setTimeout(()=>{
        if(alive(room).length<=1) endGame(code);
        else startBattle(code);
    }, 3500);
}

/* ═══════════════════ OYUN SONU ═══════════════════ */
function endGame(code){
    const room=rooms.get(code); if(!room) return;
    room.state='finished'; room.phase='gameover';
    const rankings=room.players.map(p=>({
        id:p.id, name:p.name, color:p.color, eliminated:!!p.eliminated,
        score:score(room,p), territories:regionCount(room,p.id),
        conquestScore:p.conquestScore||0, defenseScore:p.defenseScore||0,
        regionScore:regionCount(room,p.id)*C.SCORE_REGION
    })).sort((a,b)=> a.eliminated!==b.eliminated ? (a.eliminated?1:-1) : b.score-a.score);

    io.to(code).emit('gameOver',{rankings, winner:rankings[0], map:room.map, players:safeList(room)});
}

/* ═══════════════════ SOCKET.IO ═══════════════════ */
io.on('connection', socket=>{
    console.log('Bağlantı:', socket.id);

    socket.on('createRoom', ({playerName})=>{
        if(!playerName?.trim()) return socket.emit('error',{msg:'İsim gerekli!'});
        const code=genCode();
        const p={
            id:socket.id, name:playerName.trim().substring(0,15),
            color:C.COLORS[0], ready:false, isHost:true,
            eliminated:false, conquestScore:0, defenseScore:0, powerUps:{}
        };
        rooms.set(code, createRoom(code,p));
        socket.join(code); socket.roomCode=code; socket.playerId=socket.id;
        socket.emit('roomCreated',{code, colors:C.COLORS});
        io.to(code).emit('playerList',{players:safeList(rooms.get(code))});
    });

    socket.on('joinRoom', ({roomCode,playerName})=>{
        if(!playerName?.trim()) return socket.emit('error',{msg:'İsim gerekli!'});
        const code=roomCode.toUpperCase();
        const room=rooms.get(code);
        if(!room) return socket.emit('error',{msg:'Oda bulunamadı!'});
        if(room.state!=='lobby') return socket.emit('error',{msg:'Oyun zaten başlamış!'});
        if(room.players.length>=16) return socket.emit('error',{msg:'Oda dolu!'});
        if(room.players.some(p=>p.name.toLowerCase()===playerName.trim().toLowerCase()))
            return socket.emit('error',{msg:'Bu isim kullanılıyor!'});

        // İlk kullanılmayan rengi bul
        const usedColors = room.players.map(p=>p.color);
        let defaultColor = C.COLORS[room.players.length % C.COLORS.length];
        for(const c of C.COLORS){ if(!usedColors.includes(c)){ defaultColor=c; break; } }

        const p={
            id:socket.id, name:playerName.trim().substring(0,15),
            color:defaultColor,
            ready:false, isHost:false, eliminated:false,
            conquestScore:0, defenseScore:0, powerUps:{}
        };
        room.players.push(p);
        socket.join(code); socket.roomCode=code; socket.playerId=socket.id;
        socket.emit('roomJoined',{code, colors:C.COLORS});
        io.to(code).emit('playerList',{players:safeList(room)});
        io.to(code).emit('toast',{msg:`${p.name} katıldı!`,type:'info'});
    });

    socket.on('changeColor', ({color})=>{
        const room=rooms.get(socket.roomCode); if(!room||room.state!=='lobby') return;
        if(!C.COLORS.includes(color)) return;
        // Bu renk başka biri tarafından kullanılıyor mu?
        const taken = room.players.some(p=>p.id!==socket.id && p.color===color);
        if(taken) return socket.emit('error',{msg:'Bu renk kullanılıyor!'});
        const p=room.players.find(x=>x.id===socket.id);
        if(p){ p.color=color; io.to(socket.roomCode).emit('playerList',{players:safeList(room)}); }
    });

    socket.on('playerReady', ()=>{
        const room=rooms.get(socket.roomCode); if(!room) return;
        const p=room.players.find(x=>x.id===socket.id);
        if(p){ p.ready=!p.ready; io.to(socket.roomCode).emit('playerList',{players:safeList(room)}); }
    });

    socket.on('startGame', ()=>{
        const room=rooms.get(socket.roomCode); if(!room) return;
        const p=room.players.find(x=>x.id===socket.id);
        if(!p||!p.isHost) return socket.emit('error',{msg:'Sadece host başlatabilir!'});
        if(room.state!=='lobby') return;
        if(room.players.length<2) return socket.emit('error',{msg:'En az 2 oyuncu gerekli!'});
        startGame(socket.roomCode);
    });

    socket.on('submitAnswer', ({answer})=>{
        const room=rooms.get(socket.roomCode);
        if(!room||room.phase!=='expansion') return;
        const n=parseFloat(answer); if(isNaN(n)) return;
        room.currentAnswers[socket.id]={value:n, time:Date.now()-room.questionStartTime};
        checkAllAnswered(room);
    });

    socket.on('selectTerritory', ({regionId})=>{
        const room=rooms.get(socket.roomCode);
        if(!room||room.selectingPlayer!==socket.id) return;
        handleSelect(socket.roomCode, socket.id, regionId);
    });

    socket.on('selectAttack', ({regionId})=>{
        const room=rooms.get(socket.roomCode);
        if(!room||room.phase!=='battle') return;
        room.currentAttacks[socket.id] = regionId!=null ? regionId : -1;
        checkAttacks(room);
    });

    socket.on('submitBattleAnswer', ({answer})=>{
        const room=rooms.get(socket.roomCode); if(!room) return;
        room.battleAnswers[socket.id]={answer, time:Date.now()-room.battleQuestionStart};
        checkBattle(room);
    });

    socket.on('submitTiebreakerAnswer', ({answer})=>{
        const room=rooms.get(socket.roomCode); if(!room) return;
        const n=parseFloat(answer); if(isNaN(n)) return;
        room.tiebreakerAnswers[socket.id]={value:n, time:Date.now()-room.tiebreakerStartTime};
        checkTiebreaker(room);
    });

    socket.on('usePowerUp', ({type})=>{
        const room=rooms.get(socket.roomCode); if(!room) return;
        const p=room.players.find(x=>x.id===socket.id);
        if(!p||!p.powerUps||!(p.powerUps[type]>0)) return;
        p.powerUps[type]--;
        if(type==='fiftyFifty' && room.currentBattleQuestion){
            const c=room.currentBattleQuestion.a;
            const w=[0,1,2,3].filter(i=>i!==c).sort(()=>Math.random()-.5).slice(0,2);
            socket.emit('fiftyFiftyResult',{removedIndices:w});
        } else if(type==='extraTime') socket.emit('extraTimeGranted',{extra:10});
        else if(type==='spy') socket.emit('spyResult',{msg:'Rakibin cevap süresini görebilirsiniz!'});
        io.to(socket.roomCode).emit('playerList',{players:safeList(room)});
    });

    socket.on('restartGame', ()=>{
        const room=rooms.get(socket.roomCode); if(!room) return;
        const p=room.players.find(x=>x.id===socket.id);
        if(!p||!p.isHost) return;
        room.state='lobby'; room.phase=null; room.map=[];
        room.expansionRound=0; room.battleRound=0; room.shrinkLevel=0;
        room.players.forEach(x=>{
            x.ready=false; x.eliminated=false;
            x.conquestScore=0; x.defenseScore=0; x.powerUps={};
        });
        io.to(socket.roomCode).emit('backToLobby',{players:safeList(room)});
    });

    socket.on('disconnect', ()=>{
        const room=rooms.get(socket.roomCode); if(!room) return;
        const idx=room.players.findIndex(p=>p.id===socket.id);
        if(idx===-1) return;
        const p=room.players[idx];
        room.players.splice(idx,1);
        if(room.state==='playing')
            room.map.forEach(r=>{ if(r.owner===socket.id){ r.owner=null; r.hasBase=false; } });
        if(p.isHost && room.players.length>0) room.players[0].isHost=true;
        if(!room.players.length){ rooms.delete(socket.roomCode); return; }
        io.to(socket.roomCode).emit('playerList',{players:safeList(room)});
        io.to(socket.roomCode).emit('toast',{msg:`${p.name} ayrıldı`,type:'warn'});
        if(room.state==='playing' && alive(room).length<=1) endGame(socket.roomCode);
    });
});

/* ═══════════════════ SUNUCU ═══════════════════ */
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
server.listen(PORT, HOST, ()=>{
    console.log(`\n  ⚔️  Bil ve Fethet Sunucusu çalışıyor!`);
    console.log(`  🌐 http://localhost:${PORT}\n`);
});
