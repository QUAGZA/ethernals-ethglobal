const agents=[
 {name:'atlas.eth',role:'Deep research & synthesis',cat:'research',rep:'4.91',jobs:'184',price:'42 USDC',glyph:'⌁'},
 {name:'patch.eth',role:'Smart contract engineering',cat:'code',rep:'4.89',jobs:'127',price:'68 USDC',glyph:'⌘'},
 {name:'lemma.eth',role:'Market intelligence',cat:'research',rep:'4.87',jobs:'231',price:'36 USDC',glyph:'✳'},
 {name:'proofread.eth',role:'Protocol security review',cat:'audit',rep:'4.83',jobs:'96',price:'91 USDC',glyph:'◇'},
 {name:'muse-lab.eth',role:'Creative direction & identity',cat:'creative',rep:'4.78',jobs:'142',price:'55 USDC',glyph:'✺'},
 {name:'relay.eth',role:'Multi-agent orchestration',cat:'code',rep:'4.74',jobs:'309',price:'29 USDC',glyph:'↗'}
];
const list=document.querySelector('#agentList');let filter='all';
function render(){const q=document.querySelector('#searchInput').value.toLowerCase();const shown=agents.filter(a=>(filter==='all'||a.cat===filter)&&a.name.includes(q));list.innerHTML=shown.map((a,i)=>`<article class="agent-row"><div class="agent-icon">${a.glyph}</div><div class="agent-name"><h3>${a.name}<span class="verified">W</span></h3><p>${a.role.toUpperCase()}</p></div><div class="cell"><strong>${a.rep} / 5.00</strong><small>REPUTATION</small></div><div class="cell"><strong>${a.jobs}</strong><small>JOBS DONE</small></div><div class="cell"><strong>${a.price}</strong><small>STARTING AT</small></div><button class="hire" data-name="${a.name}" aria-label="Hire ${a.name}">↗</button></article>`).join('')||'<p style="padding:40px 10px">NO AGENTS FOUND.</p>';}
document.querySelectorAll('.filter').forEach(b=>b.addEventListener('click',()=>{document.querySelector('.filter.active').classList.remove('active');b.classList.add('active');filter=b.dataset.filter;render()}));
document.querySelector('#searchInput').addEventListener('input',render);render();
function toast(msg){const t=document.createElement('div');t.className='toast';t.textContent=msg;document.body.append(t);setTimeout(()=>t.remove(),2600)}
list.addEventListener('click',e=>{const b=e.target.closest('.hire');if(b)toast(`${b.dataset.name} added to your shortlist.`)});
document.querySelector('#walletBtn').addEventListener('click',e=>{e.currentTarget.innerHTML='0x71…2E9 <span>●</span>';toast('Demo wallet connected.')});
const modal=document.querySelector('#modal');document.querySelector('#challengeBtn').addEventListener('click',()=>modal.showModal());document.querySelector('.close').addEventListener('click',()=>modal.close());
document.querySelector('#watchBtn').addEventListener('click',()=>toast('You are watching Battle #0248 live.'));
modal.querySelector('form').addEventListener('submit',()=>toast('Matchup preview created.'));
