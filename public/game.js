/* ═══════════════════════════════════════════
   BIL VE FETHET — PREMIUM GAME ENGINE
   Türkiye Haritası + Hedef Tahtası + Gerçek Trivador
   ═══════════════════════════════════════════ */
const socket = io();

/* ══════════ STATE ══════════ */
const S = {
    myId:null, roomCode:null, players:[], map:[], phase:null, isHost:false,
    selectable:[], attackable:[], timerInterval:null, answered:false,
    myPowerUps:{fiftyFifty:1,extraTime:1,spy:1},
    expRounds:4, batRounds:6, curExp:0, curBat:0, battle:null,
    allColors:[], myColor:null
};

/* ══════════ PARTICLES ══════════ */
const Particles = {
    cvs:null, ctx:null, pts:[],
    init(){
        this.cvs=document.getElementById('particleCanvas');
        this.ctx=this.cvs.getContext('2d');
        this.resize(); window.addEventListener('resize',()=>this.resize());
        this.spawn(); this.loop();
    },
    resize(){ this.cvs.width=innerWidth; this.cvs.height=innerHeight; },
    spawn(){
        this.pts=[];
        const n=Math.min(50, Math.floor(innerWidth/30));
        for(let i=0;i<n;i++) this.pts.push({
            x:Math.random()*this.cvs.width, y:Math.random()*this.cvs.height,
            r:Math.random()*2+.4, vx:(Math.random()-.5)*.25, vy:(Math.random()-.5)*.15,
            o:Math.random()*.25+.03, p:Math.random()*Math.PI*2
        });
    },
    loop(){
        const c=this.ctx, w=this.cvs.width, h=this.cvs.height;
        c.clearRect(0,0,w,h);
        for(const p of this.pts){
            p.x+=p.vx; p.y+=p.vy; p.p+=.012;
            if(p.x<0)p.x=w; if(p.x>w)p.x=0; if(p.y<0)p.y=h; if(p.y>h)p.y=0;
            c.beginPath(); c.arc(p.x,p.y,p.r,0,Math.PI*2);
            c.fillStyle=`rgba(255,215,0,${Math.max(0,p.o+Math.sin(p.p)*.08)})`;
            c.fill();
        }
        requestAnimationFrame(()=>this.loop());
    }
};

/* ══════════ AUDIO ══════════ */
const SFX = {
    ctx:null,
    init(){ try{this.ctx=new(window.AudioContext||window.webkitAudioContext)()}catch(e){} },
    play(t){
        if(!this.ctx)return;
        try{
            const now=this.ctx.currentTime;
            const o=this.ctx.createOscillator();
            const g=this.ctx.createGain();
            o.connect(g); g.connect(this.ctx.destination);
            const presets={
                click:{f:[800],g:[.06],d:.08,type:'sine'},
                ok:{f:[523,659,784],g:[.1],d:.35,type:'sine'},
                bad:{f:[300,180],g:[.08],d:.35,type:'sawtooth'},
                win:{f:[523,659,784,1047],g:[.1],d:.6,type:'sine'},
                battle:{f:[220,330,440],g:[.1],d:.3,type:'sawtooth'},
                shrink:{f:[100,50],g:[.12],d:.8,type:'sawtooth'},
                castle:{f:[440,660,880],g:[.12],d:.5,type:'triangle'},
                dart:{f:[1200,300],g:[.1],d:.2,type:'sine'},
                conquer:{f:[350,500],g:[.06],d:.2,type:'square'},
                tick:{f:[600],g:[.04],d:.05,type:'sine'}
            };
            const p=presets[t]||presets.click;
            o.type=p.type;
            if(p.f.length===1){
                o.frequency.setValueAtTime(p.f[0],now);
            } else {
                p.f.forEach((f,i)=>o.frequency.setValueAtTime(f,now+i*(p.d/p.f.length)));
            }
            g.gain.setValueAtTime(p.g[0],now);
            g.gain.exponentialRampToValueAtTime(.001,now+p.d);
            o.start(now); o.stop(now+p.d);
        }catch(e){}
    }
};

/* ══════════ UI ══════════ */
const UI = {
    goTo(id){
        document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
        const el=document.getElementById(id);
        if(el) el.classList.add('active');
    },
    toast(msg,type='info'){
        const c=document.getElementById('toasts');
        const d=document.createElement('div');
        d.className=`toast t-${type}`; d.textContent=msg;
        c.appendChild(d);
        setTimeout(()=>{if(d.parentNode)d.remove()},3000);
    },
    show(id){ document.getElementById(id).classList.add('active'); },
    hide(id){ document.getElementById(id).classList.remove('active'); },
    hideAll(){ document.querySelectorAll('.overlay').forEach(o=>o.classList.remove('active')); }
};

/* ══════════ TIMER (ring style) ══════════ */
function startTimer(secs, numEl, circleEl, onEnd){
    clearInterval(S.timerInterval);
    let left=secs;
    const total=secs;
    const circ=125.66; // 2*PI*20

    const update=()=>{
        if(numEl){ numEl.textContent=left; numEl.classList.toggle('warn',left<=5); }
        if(circleEl){
            const offset=circ*(1-left/total);
            circleEl.style.strokeDashoffset=offset;
            circleEl.classList.toggle('warn',left<=5);
        }
        if(left<=5 && left>0) SFX.play('tick');
    };
    update();
    S.timerInterval=setInterval(()=>{
        left--;
        if(left<=0){
            clearInterval(S.timerInterval);
            if(numEl){numEl.textContent='0';numEl.classList.add('warn');}
            if(circleEl){circleEl.style.strokeDashoffset=circ;circleEl.classList.add('warn');}
            if(onEnd)onEnd();
            return;
        }
        update();
    },1000);
}
function stopTimer(){ clearInterval(S.timerInterval); }

/* ══════════ İL ADI KISALTMA ══════════ */
function abbr(name){
    if(!name) return '';
    // Kısa isimler aynen dönsün
    if(name.length<=3) return name;
    // Özel kısaltmalar
    const map = {
        'Afyonkarahisar':'Afyon','Kahramanmaraş':'K.Maraş','Şanlıurfa':'Ş.Urfa',
        'Eskişehir':'Eskişe.','Kırklareli':'K.eli','Tekirdağ':'Tekir.',
        'Balıkesir':'Balıke.','Çanakkale':'Çanak.','Diyarbakır':'D.bakır',
        'Erzincan':'Erzin.','Gümüşhane':'Gümüş.','Kastamonu':'Kasta.',
        'Zonguldak':'Zong.','Osmaniye':'Osman.','Kırşehir':'Kırşe.',
        'Kırıkkale':'K.kale','Karabük':'Karab.'
    };
    return map[name] || (name.length>6 ? name.substring(0,5)+'.' : name);
}

/* ══════════ TÜRKİYE HARİTASI ══════════ */
const Map = {
    render(map){
        const svg=document.getElementById('gameMap');
        svg.innerHTML='';
        svg.setAttribute('viewBox', MAP_VIEWBOX);

        // Deniz arkaplanı
        const bg=this._el('rect',{x:0,y:0,width:1005,height:490,fill:'#060420',rx:6});
        svg.appendChild(bg);

        // Deniz gridi (dekoratif)
        for(let x=0;x<1005;x+=50){
            svg.appendChild(this._el('line',{x1:x,y1:0,x2:x,y2:490,stroke:'#0a0830','stroke-width':.3,'stroke-opacity':.5}));
        }
        for(let y=0;y<490;y+=50){
            svg.appendChild(this._el('line',{x1:0,y1:y,x2:1005,y2:y,stroke:'#0a0830','stroke-width':.3,'stroke-opacity':.5}));
        }

        for(const r of map){
            const g=document.createElementNS('http://www.w3.org/2000/svg','g');
            g.setAttribute('data-id',r.id);
            g.classList.add('map-region');
            if(r.burned) g.classList.add('burned');

            // Path
            const path=this._el('path',{d:r.path,class:'rp'});
            if(r.burned){
                Object.assign(path.style,{});
                path.setAttribute('fill','#080420');
                path.setAttribute('stroke','#120a30');
            } else if(r.owner){
                const p=S.players.find(x=>x.id===r.owner);
                const col=p?p.color:'#555';
                path.setAttribute('fill',col);
                path.setAttribute('fill-opacity','0.5');
                path.setAttribute('stroke',col);
                path.setAttribute('stroke-opacity','0.9');
            } else {
                path.setAttribute('fill','#140e30');
                path.setAttribute('fill-opacity','0.65');
                path.setAttribute('stroke','#2a1a60');
            }
            path.setAttribute('stroke-width','0.8');
            g.appendChild(path);

            if(!r.burned){
                // Label
                const lbl=this._el('text',{x:r.x,y:r.y+(r.hasBase?-9:3),class:'rl'});
                lbl.textContent=abbr(r.name);
                g.appendChild(lbl);

                // Castle
                if(r.hasBase){
                    const c=this._el('text',{x:r.x,y:r.y+6,class:'rc castle-glow'});
                    c.textContent='\u{1F3F0}';
                    g.appendChild(c);
                    const hp=this._el('text',{x:r.x,y:r.y+13,class:'rh'});
                    hp.textContent='\u2764'.repeat(r.baseHp);
                    g.appendChild(hp);
                } else if(r.owner){
                    const p=S.players.find(x=>x.id===r.owner);
                    if(p){
                        const ini=this._el('text',{x:r.x,y:r.y+5,'text-anchor':'middle','font-size':'5','font-weight':'900',fill:'#fff',opacity:'.35'});
                        ini.textContent=p.name.charAt(0).toUpperCase();
                        g.appendChild(ini);
                    }
                }
            }

            g.addEventListener('click',()=>this.onClick(r.id));
            svg.appendChild(g);
        }
    },

    _el(tag,attrs){
        const el=document.createElementNS('http://www.w3.org/2000/svg',tag);
        for(const [k,v] of Object.entries(attrs)) el.setAttribute(k,v);
        return el;
    },

    hiSel(ids){
        document.querySelectorAll('.map-region').forEach(g=>g.classList.remove('selectable','attackable'));
        ids.forEach(id=>{const g=document.querySelector(`.map-region[data-id="${id}"]`);if(g)g.classList.add('selectable');});
        S.selectable=ids;
    },
    hiAtk(ids){
        document.querySelectorAll('.map-region').forEach(g=>g.classList.remove('selectable','attackable'));
        ids.forEach(id=>{const g=document.querySelector(`.map-region[data-id="${id}"]`);if(g)g.classList.add('attackable');});
        S.attackable=ids;
    },
    clear(){
        document.querySelectorAll('.map-region').forEach(g=>g.classList.remove('selectable','attackable'));
        S.selectable=[]; S.attackable=[];
    },

    animCastle(assignments, cb){
        // No overlay - animate castles directly on the map
        let i=0;
        const next=()=>{
            if(i>=assignments.length){
                // All castles placed, start countdown
                setTimeout(()=>{
                    this.showCastleCountdown(cb);
                },700);
                return;
            }
            const a=assignments[i];
            const p=S.players.find(x=>x.id===a.playerId);
            const r=S.map.find(x=>x.id===a.regionId);

            // Show toast for each castle placement
            if(p&&r) UI.toast(`${p.name} → ${r.name}`,'ok');

            const g=document.querySelector(`.map-region[data-id="${a.regionId}"]`);
            if(g){
                const path=g.querySelector('.rp');
                if(path&&p){path.setAttribute('fill',p.color);path.setAttribute('fill-opacity','.5');path.setAttribute('stroke',p.color);}

                const c=this._el('text',{x:r.x,y:r.y+5,class:'rc castle-drop'});
                c.textContent='\u{1F3F0}'; g.appendChild(c);
                const hp=this._el('text',{x:r.x,y:r.y+13,class:'rh castle-drop'});
                hp.textContent='\u2764\u2764\u2764'; g.appendChild(hp);
                const lbl=g.querySelector('.rl');
                if(lbl) lbl.setAttribute('y',r.y-7);
                SFX.play('castle');
            }
            i++; setTimeout(next,1300);
        };
        setTimeout(next,500);
    },

    showCastleCountdown(cb){
        // Show a 10-second countdown on the map so players can see castles
        const mapArea=document.querySelector('.map-area');
        const cdEl=document.createElement('div');
        cdEl.className='castle-countdown';
        cdEl.innerHTML='<span class="cc-label">Oyun Ba\u015Fl\u0131yor</span><span class="cc-num">10</span>';
        mapArea.style.position='relative';
        mapArea.appendChild(cdEl);
        let sec=10;
        const numEl=cdEl.querySelector('.cc-num');
        const cInt=setInterval(()=>{
            sec--;
            numEl.textContent=sec;
            if(sec<=3) numEl.style.color='var(--red)';
            if(sec<=0){
                clearInterval(cInt);
                cdEl.remove();
                if(cb) cb();
            }
        },1000);
    },

    flash(rid){
        const g=document.querySelector(`.map-region[data-id="${rid}"]`);
        if(g){g.classList.add('region-flash');SFX.play('conquer');setTimeout(()=>g.classList.remove('region-flash'),800);}
    },

    onClick(rid){
        if(S.selectable.includes(rid)){
            socket.emit('selectTerritory',{regionId:rid});
            this.clear(); UI.hide('selectOverlay'); stopTimer(); SFX.play('ok');
        }
        if(S.attackable.includes(rid)){
            socket.emit('selectAttack',{regionId:rid});
            this.clear(); UI.hide('attackOverlay'); stopTimer(); SFX.play('battle');
        }
    }
};

/* ══════════ TUR TRACKER ══════════ */
function renderTracker(){
    const t=document.getElementById('turnTracker'); t.innerHTML='';
    for(let i=1;i<=S.expRounds;i++){
        const d=document.createElement('div');
        d.className='turn-dot exp'; d.textContent=i;
        if(S.phase==='expansion'&&i===S.curExp) d.classList.add('now');
        else if(i<S.curExp||(S.phase==='battle'||S.phase==='gameover')) d.classList.add('done');
        t.appendChild(d);
    }
    const div=document.createElement('div'); div.className='turn-div'; t.appendChild(div);
    for(let i=1;i<=S.batRounds;i++){
        const d=document.createElement('div');
        d.className='turn-dot bat'; d.textContent=i;
        if(S.phase==='battle'&&i===S.curBat) d.classList.add('now');
        else if(i<S.curBat||S.phase==='gameover') d.classList.add('done');
        t.appendChild(d);
    }
}

/* ══════════ DART BOARD (Canvas) ══════════ */
function drawDartBoard(){
    const cvs=document.getElementById('dartCanvas');
    const ctx=cvs.getContext('2d');
    const w=cvs.width, h=cvs.height, cx=w/2, cy=h/2;
    ctx.clearRect(0,0,w,h);

    // Halkalar
    const rings=[
        {r:140,fill:'#120830'},{r:112,fill:'#160a3a'},{r:84,fill:'#1a0e44'},
        {r:56,fill:'#1e124e'},{r:28,fill:'#221658'}
    ];
    rings.forEach(ring=>{
        ctx.beginPath(); ctx.arc(cx,cy,ring.r,0,Math.PI*2);
        ctx.fillStyle=ring.fill; ctx.fill();
        ctx.strokeStyle='#2a1860'; ctx.lineWidth=1; ctx.stroke();
    });

    // Çapraz çizgiler
    ctx.strokeStyle='rgba(60,40,120,.3)'; ctx.lineWidth=.5;
    for(let a=0;a<Math.PI;a+=Math.PI/6){
        ctx.beginPath();
        ctx.moveTo(cx+Math.cos(a)*140,cy+Math.sin(a)*140);
        ctx.lineTo(cx-Math.cos(a)*140,cy-Math.sin(a)*140);
        ctx.stroke();
    }

    // Bullseye
    ctx.beginPath(); ctx.arc(cx,cy,10,0,Math.PI*2);
    ctx.fillStyle='rgba(255,215,0,.7)'; ctx.fill();
    ctx.beginPath(); ctx.arc(cx,cy,3,0,Math.PI*2);
    ctx.fillStyle='#fff'; ctx.fill();

    // Skor halkaları yazıları
    const labels=['100','80','60','40','20'];
    ctx.font='bold 9px Nunito'; ctx.fillStyle='rgba(255,215,0,.3)'; ctx.textAlign='center';
    [130,102,74,46,22].forEach((r,i)=>{
        ctx.fillText(labels[i], cx+r-8, cy-3);
    });
}

function showDart(rankings, correct, unit){
    UI.hideAll();
    document.getElementById('dartCorrect').textContent=`Doğru cevap: ${correct} ${unit}`;
    const arrows=document.getElementById('dartArrows'); arrows.innerHTML='';
    const ranks=document.getElementById('dartRankings'); ranks.innerHTML='';

    drawDartBoard();

    const size=280, center=size/2, maxR=130;

    rankings.forEach((r,i)=>{
        const arrow=document.createElement('div');
        arrow.className='dart-arrow';
        arrow.style.background=r.color;

        // Random rotation for realistic stuck-dart look
        const rot=-5+Math.random()*10;
        arrow.style.setProperty('--dart-rot', rot+'deg');

        const dist=r.dartDistance*maxR;
        const angle=(i/rankings.length)*Math.PI*2 - Math.PI/2 + (Math.random()-.5)*.5;
        arrow.style.left=(center+Math.cos(angle)*dist)+'px';
        arrow.style.top=(center+Math.sin(angle)*dist)+'px';

        // Dart flights (feathers) with player color
        const flights=document.createElement('div');
        flights.className='dart-flights';
        flights.style.setProperty('--fc', r.color);
        flights.style.cssText+=`;`;
        // Set flight colors via pseudo-elements won't work inline, use bg
        const flStyle=document.createElement('style');
        flStyle.textContent=`.dart-arrow:nth-child(${i+1}) .dart-flights::before,.dart-arrow:nth-child(${i+1}) .dart-flights::after{background:${r.color}}`;
        document.head.appendChild(flStyle);
        arrow.appendChild(flights);

        // Dart point (tip)
        const point=document.createElement('div');
        point.className='dart-point';
        arrow.appendChild(point);

        // Rank badge
        const badge=document.createElement('span');
        badge.className='rank-badge';
        badge.style.background=r.color;
        badge.textContent=r.rank;
        arrow.appendChild(badge);

        // Name label
        const lbl=document.createElement('span');
        lbl.className='al'; lbl.textContent=r.name;
        arrow.appendChild(lbl);
        arrows.appendChild(arrow);

        setTimeout(()=>{arrow.classList.add('vis');SFX.play('dart');},500+i*550);

        const item=document.createElement('div'); item.className='dr-item';
        item.innerHTML=`
            <span class="dr-rank">#${r.rank}</span>
            <div class="dr-dot" style="background:${r.color}"></div>
            <span class="dr-name">${r.name}${r.playerId===S.myId?' (Sen)':''}</span>
            <span class="dr-ans">${r.answer!==null?r.answer:'-'}</span>
            <span class="dr-diff">${r.diff!==null&&r.diff!==Infinity?'(±'+Math.round(r.diff)+')':'(yok)'}</span>
            <span class="dr-picks">${r.territoryPicks>0?r.territoryPicks+' seçim':''}</span>
        `;
        ranks.appendChild(item);
    });

    const info=document.getElementById('dartPicksInfo');
    if(rankings.length>0){
        let txt=`${rankings[0].name} → 2 toprak`;
        if(rankings[1]) txt+=` | ${rankings[1].name} → 1 toprak`;
        info.textContent=txt;
    }
    UI.show('dartOverlay');
}

/* ══════════ PLAYER BAR ══════════ */
function renderBar(){
    const bar=document.getElementById('playerBar'); bar.innerHTML='';
    S.players.forEach(p=>{
        const d=document.createElement('div');
        d.className='pb-item'+(p.eliminated?' dead':'')+(p.id===S.myId?' me':'');
        const castle=S.map.some(r=>r.owner===p.id&&r.hasBase&&!r.burned);
        d.innerHTML=`
            <div class="pb-dot" style="background:${p.color}"></div>
            <span class="pb-name">${p.name}</span>
            <span class="pb-ter">${p.territories||0}</span>
            ${castle?'<span class="pb-castle">\u{1F3F0}</span>':''}
            <span class="pb-score">${p.score||0}</span>
        `;
        bar.appendChild(d);
    });
}

function updatePU(){
    const me=S.players.find(p=>p.id===S.myId); if(!me) return;
    S.myPowerUps=me.powerUps||{};
    document.querySelectorAll('.pu-btn').forEach(b=>{
        const t=b.dataset.type, c=S.myPowerUps[t]||0;
        b.querySelector('.pu-count').textContent=c;
        b.classList.toggle('used',c<=0);
    });
}

/* ══════════ CONFETTI ══════════ */
function confetti(color){
    const cvs=document.getElementById('confettiCanvas');
    const ctx=cvs.getContext('2d');
    cvs.width=innerWidth; cvs.height=innerHeight;
    const colors=[color,'#ffd700','#fff',adjustCol(color,40),adjustCol(color,-40)];
    const pieces=[];
    for(let i=0;i<120;i++) pieces.push({
        x:Math.random()*cvs.width, y:-20-Math.random()*200,
        w:Math.random()*8+4, h:Math.random()*8+4,
        col:colors[Math.floor(Math.random()*colors.length)],
        vx:(Math.random()-.5)*4, vy:Math.random()*3+2,
        rot:Math.random()*360, vr:(Math.random()-.5)*8,
        round:Math.random()>.5
    });
    let frame=0;
    const loop=()=>{
        ctx.clearRect(0,0,cvs.width,cvs.height);
        for(const p of pieces){
            p.x+=p.vx; p.y+=p.vy; p.vy+=.05; p.rot+=p.vr;
            ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.rot*Math.PI/180);
            ctx.globalAlpha=Math.max(0,1-frame/200);
            ctx.fillStyle=p.col;
            if(p.round){ctx.beginPath();ctx.arc(0,0,p.w/2,0,Math.PI*2);ctx.fill();}
            else ctx.fillRect(-p.w/2,-p.h/2,p.w,p.h);
            ctx.restore();
        }
        frame++;
        if(frame<250) requestAnimationFrame(loop);
        else ctx.clearRect(0,0,cvs.width,cvs.height);
    };
    loop();
}

function adjustCol(hex,amt){
    let r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
    r=Math.min(255,Math.max(0,r+amt));g=Math.min(255,Math.max(0,g+amt));b=Math.min(255,Math.max(0,b+amt));
    return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}

/* ══════════ EVENT LISTENERS ══════════ */
// Menu
document.getElementById('btnCreateRoom').addEventListener('click',()=>{
    const n=document.getElementById('playerNameInput').value.trim();
    if(!n){UI.toast('Adını yaz!','err');return;}
    SFX.init(); SFX.play('click');
    socket.emit('createRoom',{playerName:n});
});
document.getElementById('btnJoinRoom').addEventListener('click',()=>{
    const n=document.getElementById('playerNameInput').value.trim();
    const c=document.getElementById('roomCodeInput').value.trim();
    if(!n){UI.toast('Adını yaz!','err');return;}
    if(!c){UI.toast('Oda kodunu gir!','err');return;}
    SFX.init(); SFX.play('click');
    socket.emit('joinRoom',{playerName:n,roomCode:c});
});
document.getElementById('roomCodeInput').addEventListener('keypress',e=>{if(e.key==='Enter')document.getElementById('btnJoinRoom').click();});
document.getElementById('playerNameInput').addEventListener('keypress',e=>{if(e.key==='Enter')document.getElementById('btnCreateRoom').click();});

// Lobby
document.getElementById('btnCopyCode').addEventListener('click',()=>{navigator.clipboard.writeText(S.roomCode).then(()=>UI.toast('Kopyalandı!','ok'));});
document.getElementById('btnReady').addEventListener('click',()=>{socket.emit('playerReady');SFX.play('click');});
document.getElementById('btnStartGame').addEventListener('click',e=>{e.preventDefault();e.stopPropagation();socket.emit('startGame');SFX.play('click');});
document.getElementById('btnLeave').addEventListener('click',()=>location.reload());

// Questions
document.getElementById('qSubmitBtn').addEventListener('click',()=>{
    if(S.answered)return;
    const v=document.getElementById('qInput').value.trim(); if(!v)return;
    S.answered=true; socket.emit('submitAnswer',{answer:v});
    document.getElementById('qInput').disabled=true;
    document.getElementById('qSubmitBtn').disabled=true;
    UI.toast('Gönderildi!','ok'); SFX.play('ok');
});
document.getElementById('qInput').addEventListener('keypress',e=>{if(e.key==='Enter')document.getElementById('qSubmitBtn').click();});

document.getElementById('battleOptions').addEventListener('click',e=>{
    const btn=e.target.closest('.q-option'); if(!btn||S.answered)return;
    if(!S.battle||( S.battle.attackerId!==S.myId && S.battle.defenderId!==S.myId))return;
    S.answered=true; socket.emit('submitBattleAnswer',{answer:parseInt(btn.dataset.idx)});
    btn.classList.add('selected'); SFX.play('click');
});

document.getElementById('tbSubmitBtn').addEventListener('click',()=>{
    if(S.answered)return;
    const v=document.getElementById('tbInput').value.trim(); if(!v)return;
    S.answered=true; socket.emit('submitTiebreakerAnswer',{answer:v});
    document.getElementById('tbInput').disabled=true;
    document.getElementById('tbSubmitBtn').disabled=true;
    SFX.play('ok');
});
document.getElementById('tbInput').addEventListener('keypress',e=>{if(e.key==='Enter')document.getElementById('tbSubmitBtn').click();});

document.getElementById('btnPass').addEventListener('click',()=>{
    socket.emit('selectAttack',{regionId:null}); Map.clear(); UI.hide('attackOverlay'); stopTimer(); SFX.play('click');
});

document.querySelectorAll('.pu-btn').forEach(b=>b.addEventListener('click',()=>{
    const t=b.dataset.type; if(S.myPowerUps[t]>0){socket.emit('usePowerUp',{type:t});SFX.play('click');}
}));

document.getElementById('btnRematch').addEventListener('click',()=>{socket.emit('restartGame');SFX.play('click');});
document.getElementById('btnBackMenu').addEventListener('click',()=>location.reload());

/* ══════════ RENK SEÇİCİ ══════════ */
function buildColorGrid(){
    const grid=document.getElementById('colorGrid');
    grid.innerHTML='';
    S.allColors.forEach(c=>{
        const btn=document.createElement('button');
        btn.className='color-swatch';
        btn.style.background=c;
        btn.dataset.color=c;
        // Eğer başka oyuncu kullanıyorsa kilitle
        const taken=S.players.some(p=>p.id!==S.myId && p.color===c);
        if(taken) btn.classList.add('taken');
        // Benim rengim mi
        const me=S.players.find(p=>p.id===S.myId);
        if(me && me.color===c) btn.classList.add('selected');
        btn.addEventListener('click',()=>{
            if(taken) return;
            socket.emit('changeColor',{color:c});
            SFX.play('click');
        });
        grid.appendChild(btn);
    });
}

/* ══════════ SOCKET EVENTS ══════════ */
socket.on('roomCreated',d=>{
    S.roomCode=d.code; S.myId=socket.id; S.isHost=true;
    S.allColors=d.colors||[];
    document.getElementById('lobbyRoomCode').textContent=d.code;
    UI.goTo('lobbyScreen');
});
socket.on('roomJoined',d=>{
    S.roomCode=d.code; S.myId=socket.id; S.isHost=false;
    S.allColors=d.colors||[];
    document.getElementById('lobbyRoomCode').textContent=d.code;
    UI.goTo('lobbyScreen');
});

socket.on('playerList',d=>{
    S.players=d.players;
    const grid=document.getElementById('playerGrid'); grid.innerHTML='';
    d.players.forEach(p=>{
        const c=document.createElement('div');
        c.className='player-card'+(p.ready?' is-ready':'')+(p.isHost?' is-host':'');
        c.innerHTML=`<div class="pc-avatar" style="background:${p.color}">${p.name.charAt(0).toUpperCase()}</div><div class="pc-name">${p.name}</div>${p.isHost?'<span class="pc-badge host">HOST</span>':''}${p.ready?'<span class="pc-badge ready">HAZIR</span>':''}`;
        grid.appendChild(c);
    });
    const me=d.players.find(p=>p.id===S.myId);
    const rb=document.getElementById('btnReady');
    if(me&&me.ready){rb.classList.add('is-ready');rb.textContent='Hazır!';}
    else{rb.classList.remove('is-ready');rb.textContent='Hazırım!';}
    const sb=document.getElementById('btnStartGame');
    if(me&&me.isHost){S.isHost=true;sb.style.display='';const can=d.players.length>=2;can?sb.classList.remove('disabled'):sb.classList.add('disabled');}
    else sb.style.display='none';
    document.getElementById('lobbyStatus').textContent=`${d.players.length} oyuncu | ${d.players.filter(p=>p.ready).length} hazır`;
    // Renk grid güncelle
    if(S.allColors.length) buildColorGrid();
    renderBar(); updatePU();
});

socket.on('gameStarted',d=>{
    S.map=d.map; S.players=d.players; S.phase='setup';
    S.expRounds=d.totalExpansionRounds; S.batRounds=d.totalBattleRounds;
    S.curExp=0; S.curBat=0;
    UI.goTo('gameScreen');

    // İlk render kalelersiz
    const clean=d.map.map(r=>({...r,hasBase:false,owner:null,baseHp:0}));
    S.map=clean; Map.render(S.map); renderBar(); updatePU(); renderTracker();
    document.getElementById('phaseBadge').textContent='Hazırlık';
    document.getElementById('roundInfo').textContent='Kaleler kuruluyor...';

    setTimeout(()=>{
        S.map=d.map; Map.render(S.map);
        Map.animCastle(d.castleAssignments,()=>{renderBar();UI.toast('Genişleme başlıyor!','ok');});
    },400);
    SFX.play('win');
});

socket.on('expansionQuestion',d=>{
    S.phase='expansion'; S.answered=false; S.curExp=d.round;
    document.getElementById('phaseBadge').textContent='Genişleme';
    document.getElementById('phaseBadge').classList.remove('battle');
    document.getElementById('roundInfo').textContent=`Tur ${d.round}/${d.totalRounds}`;
    renderTracker();

    document.getElementById('qPhase').textContent=`Genişleme — Tur ${d.round}/${d.totalRounds}`;
    document.getElementById('qText').textContent=d.question;
    document.getElementById('qUnit').textContent=d.unit?`(${d.unit})`:'';
    document.getElementById('qInput').value='';
    document.getElementById('qInput').disabled=false;
    document.getElementById('qSubmitBtn').disabled=false;

    UI.hideAll(); UI.show('questionOverlay');
    startTimer(d.timeLimit, document.getElementById('qTimer'), document.getElementById('qTimerCircle'), ()=>{
        if(!S.answered){S.answered=true;socket.emit('submitAnswer',{answer:0});UI.toast('Süre doldu!','err');}
    });
    setTimeout(()=>document.getElementById('qInput').focus(),300);
});

socket.on('expansionResults',d=>{stopTimer();showDart(d.rankings,d.correctAnswer,d.unit);});

socket.on('selectTerritoryTurn',d=>{
    UI.hideAll();
    if(d.playerId===S.myId){
        Map.hiSel(d.selectableRegions);
        document.getElementById('selectText').textContent='Toprak seç!';
        document.getElementById('selectPicks').textContent=`(${d.picksLeft} seçim hakkı)`;
        UI.show('selectOverlay');
        startTimer(10, document.getElementById('selectTimer'), document.getElementById('selectTimerCircle'));
        UI.toast('Senin sıran!','ok');
    } else {
        document.getElementById('selectText').textContent=`${d.playerName} seçiyor...`;
        document.getElementById('selectPicks').textContent='';
        UI.show('selectOverlay');
        Map.hiSel(d.selectableRegions);
    }
});

socket.on('territorySelected',d=>{
    S.map=d.map; S.players=d.players;
    Map.render(S.map); Map.clear(); Map.flash(d.regionId); renderBar();
    const p=S.players.find(x=>x.id===d.playerId);
    if(p) UI.toast(`${p.name} → ${d.regionName}`,'info');
});

socket.on('phaseChange',d=>{
    if(d.phase==='battle'){
        S.phase='battle'; S.curBat=0;
        document.getElementById('pcIcon').textContent='\u2694\uFE0F';
        document.getElementById('pcTitle').textContent='Savaş Aşaması';
        document.getElementById('pcSub').textContent='Topraklarını savun, düşmanlarını fethet!';
        UI.hideAll(); UI.show('phaseChangeOverlay'); SFX.play('battle');
        setTimeout(()=>{UI.hide('phaseChangeOverlay');document.getElementById('phaseBadge').textContent='Savaş';document.getElementById('phaseBadge').classList.add('battle');},2000);
    }
    renderTracker();
});

socket.on('battlePhase',d=>{
    S.phase='battle'; S.map=d.map; S.players=d.players; S.curBat=d.round;
    document.getElementById('phaseBadge').textContent='Savaş';
    document.getElementById('phaseBadge').classList.add('battle');
    document.getElementById('roundInfo').textContent=`Savaş ${d.round}/${d.totalRounds}`;
    renderTracker(); Map.render(S.map); renderBar(); updatePU(); UI.hideAll();

    const my=d.attackOptions[S.myId]||[];
    if(my.length>0){
        Map.hiAtk(my);
        document.getElementById('attackText').textContent='Saldıracağın bölgeyi seç!';
        UI.show('attackOverlay');
        startTimer(d.timeLimit, document.getElementById('attackTimer'), document.getElementById('attackTimerCircle'), ()=>{
            socket.emit('selectAttack',{regionId:null}); Map.clear(); UI.hide('attackOverlay');
        });
    } else {
        socket.emit('selectAttack',{regionId:null});
        UI.toast('Saldıracak bölge yok','info');
    }
});

socket.on('battleQuestion',d=>{
    UI.hideAll(); Map.clear(); S.answered=false; S.battle=d.battle;
    const att=S.players.find(p=>p.id===d.battle.attackerId);
    const def=S.players.find(p=>p.id===d.battle.defenderId);
    const isP=d.battle.attackerId===S.myId||d.battle.defenderId===S.myId;

    document.getElementById('bAtkAvatar').textContent=att?att.name.charAt(0):'A';
    document.getElementById('bAtkAvatar').style.background=att?att.color:'#e74c3c';
    document.getElementById('bAtkName').textContent=d.battle.attackerName;
    document.getElementById('bDefAvatar').textContent=def?def.name.charAt(0):'D';
    document.getElementById('bDefAvatar').style.background=def?def.color:'#3498db';
    document.getElementById('bDefName').textContent=d.battle.defenderName;
    document.getElementById('bTarget').textContent=d.battle.targetRegionName||'';
    document.getElementById('battleQText').textContent=d.question;

    document.querySelectorAll('#battleOptions .q-option').forEach((b,i)=>{
        b.innerHTML=''; b.textContent=d.options[i]; b.className='q-option'; b.dataset.idx=i;
        b.style.pointerEvents=isP?'':'none';
        b.style.borderColor=''; b.style.background=''; b.style.boxShadow='';
    });

    UI.show('battleOverlay');
    startTimer(d.timeLimit, document.getElementById('battleTimerNum'), document.getElementById('battleTimerCircle'), ()=>{
        if(!S.answered&&isP){S.answered=true;socket.emit('submitBattleAnswer',{answer:-1});}
    });
    SFX.play('battle');
});

socket.on('battleAnswerReveal',d=>{
    stopTimer();
    const opts=document.querySelectorAll('#battleOptions .q-option');

    // Tüm seçenekleri devre dışı bırak
    opts.forEach((b,i)=>{
        b.style.pointerEvents='none';
        b.classList.remove('selected','correct','wrong');
        // Doğru cevabı beyaz parlayan border ile göster
        if(i===d.correctIndex) b.classList.add('correct-glow');
    });

    // Saldıranın seçimi - oyuncu renginde göster
    if(d.attackerAnswer>=0 && d.attackerAnswer<opts.length){
        const aBtn=opts[d.attackerAnswer];
        aBtn.style.borderColor=d.attackerColor;
        aBtn.style.background=`${d.attackerColor}20`;
        aBtn.style.boxShadow=`0 0 8px ${d.attackerColor}40`;
        const aTag=document.createElement('span');
        aTag.className='answer-tag';
        aTag.style.background=d.attackerColor;
        aTag.textContent=d.attackerName;
        aBtn.appendChild(aTag);
    }

    // Savunanın seçimi - oyuncu renginde göster
    if(d.defenderAnswer>=0 && d.defenderAnswer<opts.length){
        const dBtn=opts[d.defenderAnswer];
        // Eğer aynı şıkkı seçmedilerse kendi rengiyle boya
        if(d.defenderAnswer!==d.attackerAnswer){
            dBtn.style.borderColor=d.defenderColor;
            dBtn.style.background=`${d.defenderColor}20`;
            dBtn.style.boxShadow=`0 0 8px ${d.defenderColor}40`;
        } else {
            // Aynı şıkkı seçtilerse gradient border
            dBtn.style.boxShadow=`0 0 8px ${d.attackerColor}40, 0 0 8px ${d.defenderColor}40`;
        }
        const dTag=document.createElement('span');
        dTag.className='answer-tag';
        dTag.style.background=d.defenderColor;
        dTag.textContent=d.defenderName;
        dBtn.appendChild(dTag);
    }

    // Aynı şıkkı seçtilerse etiketleri üst üste göster
    if(d.attackerAnswer===d.defenderAnswer && d.attackerAnswer>=0){
        const btn=opts[d.attackerAnswer];
        const tags=btn.querySelectorAll('.answer-tag');
        if(tags.length===2){
            tags[0].style.top='-12px';
            tags[1].style.top='-28px';
        }
    }

    SFX.play('ok');
});

socket.on('tiebreakerQuestion',d=>{
    UI.hideAll(); S.answered=false; S.battle=d.battle;
    const isP=d.battle.attackerId===S.myId||d.battle.defenderId===S.myId;
    document.getElementById('tbQText').textContent=d.question;
    document.getElementById('tbUnit').textContent=d.unit?`(${d.unit})`:'';
    document.getElementById('tbInput').value='';
    document.getElementById('tbInput').disabled=!isP;
    document.getElementById('tbSubmitBtn').disabled=!isP;
    // Önceki sonuçları temizle
    const tbBox=document.querySelector('.tiebreaker-box');
    const oldRes=tbBox.querySelector('.tb-results');
    if(oldRes) oldRes.remove();
    const inputArea=tbBox.querySelector('.q-input-area');
    if(inputArea) inputArea.style.display='';
    UI.show('tiebreakerOverlay');
    startTimer(d.timeLimit, document.getElementById('tbTimerNum'), document.getElementById('tbTimerCircle'), ()=>{
        if(!S.answered&&isP){S.answered=true;socket.emit('submitTiebreakerAnswer',{answer:0});}
    });
    if(isP) setTimeout(()=>document.getElementById('tbInput').focus(),300);
});

socket.on('tiebreakerResult',d=>{
    stopTimer();
    const w=S.players.find(p=>p.id===d.winner);
    const att=S.players.find(p=>p.id===d.battle.attackerId);
    const def=S.players.find(p=>p.id===d.battle.defenderId);

    // Tiebreaker sonuçlarını göster
    const tbBox=document.querySelector('.tiebreaker-box');
    // Mevcut input alanını gizle
    const inputArea=tbBox.querySelector('.q-input-area');
    if(inputArea) inputArea.style.display='none';

    // Sonuç kutusu ekle
    let resDiv=tbBox.querySelector('.tb-results');
    if(!resDiv){
        resDiv=document.createElement('div');
        resDiv.className='tb-results';
        tbBox.appendChild(resDiv);
    }
    resDiv.innerHTML=`
        <div class="tb-reveal">
            <div class="tb-reveal-row">
                <span class="tb-reveal-dot" style="background:${att?att.color:'#e74c3c'}"></span>
                <span class="tb-reveal-name">${d.battle.attackerName}</span>
                <span class="tb-reveal-ans">${d.attackerAnswer!==null?d.attackerAnswer:'-'}</span>
                <span class="tb-reveal-diff">${d.attackerDiff!==null?'(±'+Math.round(d.attackerDiff)+')':'(cevap yok)'}</span>
                ${d.winner===d.battle.attackerId?'<span class="tb-reveal-win">✓</span>':''}
            </div>
            <div class="tb-reveal-row">
                <span class="tb-reveal-dot" style="background:${def?def.color:'#3498db'}"></span>
                <span class="tb-reveal-name">${d.battle.defenderName}</span>
                <span class="tb-reveal-ans">${d.defenderAnswer!==null?d.defenderAnswer:'-'}</span>
                <span class="tb-reveal-diff">${d.defenderDiff!==null?'(±'+Math.round(d.defenderDiff)+')':'(cevap yok)'}</span>
                ${d.winner===d.battle.defenderId?'<span class="tb-reveal-win">✓</span>':''}
            </div>
            <div class="tb-reveal-correct">Doğru: ${d.correctAnswer} ${d.unit}</div>
        </div>
    `;
    UI.toast(`${w?w.name:'?'} ek soruyu kazandı!`,'info');
});

socket.on('battleResult',d=>{
    UI.hideAll(); stopTimer(); S.battle=null;
    S.map=d.map; S.players=d.players; Map.render(S.map); renderBar();
    const w=S.players.find(p=>p.id===d.winner);
    const icon=d.winner===d.battle.attackerId?'\u2694\uFE0F':(d.winner===d.battle.defenderId?'\u{1F6E1}\uFE0F':'\u{1F91D}');
    document.getElementById('brIcon').textContent=icon;
    if(d.winner){
        document.getElementById('brTitle').textContent=`${w?w.name:'?'} Kazandı!`;
        document.getElementById('brTitle').style.color=w?w.color:'#ffd700';
    } else {
        document.getElementById('brTitle').textContent='Savunma Avantajı!';
        document.getElementById('brTitle').style.color='#f59e0b';
    }
    const reasons={attacker_correct:'Saldıran doğru bildi!',defender_correct:'Savunan doğru bildi!',both_wrong:'İkisi de bilemedi!',tiebreaker_closer:'Yakın tahmin kazandı!',tiebreaker_faster:'Hızlı cevap kazandı!'};
    document.getElementById('brDetail').textContent=reasons[d.reason]||'';
    document.getElementById('brAnswer').textContent='';
    document.getElementById('brTerritory').textContent=d.targetRegion?`${d.targetRegion.name}${d.targetRegion.hasBase?` (HP:${d.targetRegion.baseHp})`:''}` :'';
    UI.show('battleResultOverlay');
    if(d.winner===d.battle.attackerId) Map.flash(d.battle.targetRegionId);
    if(d.eliminated){const ep=S.players.find(p=>p.id===d.eliminated);if(ep)setTimeout(()=>UI.toast(`${ep.name} elendi!`,'err'),800);}
    d.winner===S.myId?SFX.play('ok'):d.winner?SFX.play('bad'):null;
});

socket.on('mapShrink',d=>{
    UI.hideAll(); S.map=d.map; S.players=d.players;
    Map.render(S.map); renderBar();
    UI.show('shrinkOverlay'); SFX.play('shrink');
    setTimeout(()=>UI.hide('shrinkOverlay'),3000);
});

socket.on('gameOver',d=>{
    UI.hideAll(); stopTimer(); S.players=d.players; S.map=d.map; S.phase='gameover'; renderTracker();
    document.getElementById('goTitle').textContent=`${d.winner.name} Kazandı!`;
    document.getElementById('goTitle').style.color=d.winner.color;
    document.getElementById('goSub').textContent=`${d.winner.territories} bölge | ${d.winner.score} puan`;
    const r=document.getElementById('goRankings'); r.innerHTML='';
    d.rankings.forEach((p,i)=>{
        const d2=document.createElement('div');
        d2.className='go-rank-item'+(p.eliminated?' dead':'');
        d2.innerHTML=`<span class="go-rank-pos">#${i+1}</span><div class="go-rank-dot" style="background:${p.color}"></div><span class="go-rank-name">${p.name}${p.id===S.myId?' (Sen)':''}</span><span class="go-rank-tiles">${p.territories} bl.</span><span class="go-rank-score">${p.score}</span><span class="go-rank-bd">+${p.regionScore} bölge<br>+${p.conquestScore} fetih | +${p.defenseScore} savunma</span>`;
        r.appendChild(d2);
    });
    UI.goTo('gameOverScreen'); confetti(d.winner.color); SFX.play('win');
});

socket.on('backToLobby',d=>{S.players=d.players;S.phase=null;S.map=[];S.curExp=0;S.curBat=0;S.battle=null;UI.hideAll();UI.goTo('lobbyScreen');});
socket.on('fiftyFiftyResult',d=>{d.removedIndices.forEach(i=>{const b=document.querySelectorAll('#battleOptions .q-option');if(b[i])b[i].classList.add('removed');});UI.toast('50/50!','ok');});
socket.on('extraTimeGranted',d=>UI.toast(`+${d.extra}s ek süre!`,'ok'));
socket.on('spyResult',d=>UI.toast(d.msg,'info'));
socket.on('toast',d=>UI.toast(d.msg,d.type));
socket.on('error',d=>UI.toast(d.msg,'err'));

/* ══════════ INIT ══════════ */
document.addEventListener('DOMContentLoaded',()=>{Particles.init();SFX.init();});
