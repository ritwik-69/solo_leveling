let currentPlayer = null;
let lastLoginDate = null;

async function updateUI() {
    const response = await fetch('/api/status');
    currentPlayer = await response.json();

    // Detect Reset while open
    if (lastLoginDate && lastLoginDate !== currentPlayer.last_login) {
        alert("SYSTEM: A new day has started. Daily quests have been reset.");
    }
    lastLoginDate = currentPlayer.last_login;

    // Basic Stats
    document.getElementById('level-display').textContent = currentPlayer.level;
    document.getElementById('job-display').textContent = currentPlayer.job;
    document.getElementById('rank-display').textContent = currentPlayer.rank;
    document.getElementById('stat-points').textContent = currentPlayer.stat_points;
    document.getElementById('gold-display').textContent = currentPlayer.gold;
    
    // XP Bar
    const threshold = Math.floor(100 * (currentPlayer.level ** 1.5));
    const xpPercent = (currentPlayer.xp / threshold) * 100;
    document.getElementById('xp-bar').style.width = `${xpPercent}%`;
    document.getElementById('xp-text').textContent = `${currentPlayer.xp} / ${threshold}`;

    // Active Title
    const activeTitle = currentPlayer.titles.find(t => t.active);
    document.getElementById('active-title-display').textContent = activeTitle ? `${activeTitle.name} (${activeTitle.buff})` : 'NONE';

    // Stats List
    const statsList = document.getElementById('stats-list');
    statsList.innerHTML = '';
    Object.entries(currentPlayer.stats).forEach(([name, val]) => {
        const div = document.createElement('div');
        div.className = "flex justify-between items-center p-2 bg-blue-900/10 border border-blue-500/10";
        div.innerHTML = `
            <span class="uppercase text-xs">${name}</span>
            <div class="flex items-center gap-4">
                <span class="text-sm font-bold">${val}</span>
                ${currentPlayer.stat_points > 0 ? `<button onclick="allocateStat('${name}')" class="w-6 h-6 border border-blue-500/50 hover:bg-blue-500/20 transition-all">+</button>` : ''}
            </div>
        `;
        statsList.appendChild(div);
    });

    // Penalty & Reset Timer
    updateTimers();

    renderQuests();
    renderSkills();
    renderInventory();
    renderShop();
    renderEditorData();
}

function updateTimers() {
    const now = new Date();
    const night = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
    const msUntilReset = night - now;
    
    const h = Math.floor(msUntilReset / 3600000);
    const m = Math.floor((msUntilReset % 3600000) / 60000);
    const s = Math.floor((msUntilReset % 60000) / 1000);
    
    const timeStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    document.getElementById('reset-timer').textContent = timeStr;
    
    const penaltyZone = document.getElementById('penalty-zone');
    if (currentPlayer.penalty_active) {
        penaltyZone.classList.remove('hidden');
        document.getElementById('penalty-timer').textContent = timeStr;
    } else {
        penaltyZone.classList.add('hidden');
    }
}

function renderQuests() {
    const qList = document.getElementById('quest-list');
    qList.innerHTML = '';
    currentPlayer.quests.forEach(q => qList.appendChild(createQuestEl(q, `/api/complete-task/${q.id}`)));

    const uPanel = document.getElementById('urgent-panel');
    const uList = document.getElementById('urgent-list');
    uList.innerHTML = '';
    if (currentPlayer.urgent_quests?.length > 0) {
        uPanel.classList.remove('hidden');
        currentPlayer.urgent_quests.forEach(q => uList.appendChild(createQuestEl(q, `/api/complete-urgent/${q.id}`, 'urgent')));
    } else uPanel.classList.add('hidden');

    const hList = document.getElementById('hidden-list');
    hList.innerHTML = '';
    currentPlayer.hidden_quests?.forEach(q => {
        const div = document.createElement('div');
        div.className = `p-3 border ${q.claimed ? 'border-purple-500/30 opacity-50' : 'border-purple-500/60 hover:bg-purple-500/10 cursor-pointer'}`;
        div.innerHTML = `
            <div class="flex justify-between items-center">
                <span class="${q.claimed ? 'line-through text-xs' : 'glow-text font-bold text-sm'}">${q.claimed ? q.name : '?? HIDDEN QUEST ??'}</span>
                <div class="text-right">
                    <span class="text-[10px] text-purple-400 block">+${q.xp} XP</span>
                    <span class="text-[10px] text-yellow-500 block">+${q.gold} G</span>
                </div>
            </div>
        `;
        if (!q.claimed) div.onclick = () => completeAction(`/api/claim-hidden/${q.id}`);
        hList.appendChild(div);
    });
}

function createQuestEl(q, url, type = 'daily') {
    const div = document.createElement('div');
    const isUrgent = type === 'urgent';
    div.className = `flex justify-between items-center p-3 border ${q.completed ? 'border-blue-500/30 opacity-50' : isUrgent ? 'border-red-500/60 hover:bg-red-500/10' : 'border-blue-500/50 hover:bg-blue-500/10'} cursor-pointer`;
    div.innerHTML = `
        <div class="flex items-center gap-3">
            <div class="w-4 h-4 border ${isUrgent ? 'border-red-500' : 'border-blue-500'} flex items-center justify-center">
                ${q.completed ? `<div class="w-2 h-2 ${isUrgent ? 'bg-red-500' : 'bg-blue-500'}"></div>` : ''}
            </div>
            <span class="${q.completed ? 'line-through opacity-50 text-sm' : 'text-sm'}">${q.name}</span>
        </div>
        <div class="text-right">
            <span class="text-[10px] ${isUrgent ? 'text-red-400' : 'text-blue-400'} block">+${q.xp} XP</span>
            <span class="text-[10px] text-yellow-500 block">+${q.gold} G</span>
        </div>
    `;
    if (!q.completed) div.onclick = () => completeAction(url);
    return div;
}

function renderSkills() {
    const activeList = document.getElementById('active-skills-list');
    activeList.innerHTML = '';
    currentPlayer.skills.active.forEach(s => {
        const now = Date.now() / 1000;
        const remaining = Math.max(0, Math.ceil(s.cooldown - (now - (s.last_used || 0))));
        const onCooldown = remaining > 0;

        const div = document.createElement('div');
        div.className = "relative hud-border p-4 overflow-hidden group";
        div.innerHTML = `
            <div class="flex justify-between items-start mb-2">
                <h3 class="text-blue-400 font-bold text-sm">${s.name}</h3>
                <span class="text-[10px] opacity-50">CD: ${s.cooldown}s</span>
            </div>
            <p class="text-[10px] opacity-70 mb-3">${s.description}</p>
            <button onclick="completeAction('/api/use-skill/${s.id}')" ${onCooldown ? 'disabled' : ''} class="w-full py-1 text-[10px] border border-blue-500/50 hover:bg-blue-500/20 transition-all uppercase">
                ${onCooldown ? `Cooldown: ${remaining}s` : 'Activate'}
            </button>
            ${onCooldown ? `<div class="absolute inset-0 cooldown-overlay" style="width: ${(remaining/s.cooldown)*100}%"></div>` : ''}
        `;
        activeList.appendChild(div);
    });

    const passiveList = document.getElementById('passive-skills-list');
    passiveList.innerHTML = '';
    currentPlayer.skills.passive.forEach(s => {
        const div = document.createElement('div');
        div.className = "hud-border p-4 bg-blue-900/5";
        div.innerHTML = `
            <div class="flex justify-between items-center mb-1">
                <h3 class="text-blue-400 text-sm">${s.name}</h3>
                <span class="text-[10px]">LV.${s.level}</span>
            </div>
            <p class="text-[10px] opacity-70">${s.description}</p>
        `;
        passiveList.appendChild(div);
    });
}

function renderInventory() {
    const grid = document.getElementById('inventory-grid');
    grid.innerHTML = '';
    currentPlayer.inventory.forEach(item => {
        const div = document.createElement('div');
        div.className = "hud-border p-3 flex flex-col items-center justify-center text-center cursor-pointer hover:bg-blue-500/10 transition-all";
        div.innerHTML = `
            <div class="w-10 h-10 border border-blue-500/30 mb-2 flex items-center justify-center text-xl">📦</div>
            <h4 class="text-[10px] font-bold truncate w-full">${item.name}</h4>
            <span class="text-[8px] opacity-50">QTY: ${item.count}</span>
        `;
        div.onclick = () => completeAction(`/api/use-item/${item.id}`);
        grid.appendChild(div);
    });
}

function renderShop() {
    const list = document.getElementById('shop-list');
    list.innerHTML = '';
    currentPlayer.shop.forEach(item => {
        const canAfford = currentPlayer.gold >= item.price;
        const div = document.createElement('div');
        div.className = "hud-border p-4 bg-yellow-900/5 border-yellow-500/20";
        div.innerHTML = `
            <div class="flex justify-between items-start mb-2">
                <h3 class="text-yellow-500 font-bold text-sm">${item.name}</h3>
                <span class="text-xs text-yellow-500 font-bold">${item.price} G</span>
            </div>
            <p class="text-[10px] opacity-70 mb-3 text-yellow-100/70">${item.description}</p>
            <button onclick="completeAction('/api/buy-item/${item.id}')" ${!canAfford ? 'disabled' : ''} class="w-full py-2 border ${canAfford ? 'border-yellow-500 text-yellow-500 hover:bg-yellow-500/20' : 'border-gray-800 text-gray-700'} text-[10px] uppercase font-bold">
                Purchase
            </button>
        `;
        list.appendChild(div);
    });
}

// EDITOR LOGIC
let editorData = { daily: [], urgent: [], hidden: [], shop: [], titles: [], skills_active: [], skills_passive: [] };
let isEditing = false;

function renderEditorData(force = false) {
    const activeTab = document.querySelector('.tab-btn.active')?.id;
    if (activeTab !== 'tab-editor') {
        isEditing = false;
        return;
    }

    // Only populate if we haven't started editing or if forced (on tab switch)
    if (!isEditing || force) {
        editorData.daily = JSON.parse(JSON.stringify(currentPlayer.quests));
        editorData.urgent = JSON.parse(JSON.stringify(currentPlayer.urgent_quests || []));
        editorData.hidden = JSON.parse(JSON.stringify(currentPlayer.hidden_quests || []));
        editorData.shop = JSON.parse(JSON.stringify(currentPlayer.shop || []));
        editorData.titles = JSON.parse(JSON.stringify(currentPlayer.titles || []));
        editorData.skills_active = JSON.parse(JSON.stringify(currentPlayer.skills.active || []));
        editorData.skills_passive = JSON.parse(JSON.stringify(currentPlayer.skills.passive || []));
        isEditing = true;
        refreshEditorUI();
    }
}

function refreshEditorUI() {
    const buildList = (containerId, data, type) => {
        const container = document.getElementById(containerId);
        container.innerHTML = '';
        data.forEach((item, i) => {
            const div = document.createElement('div');
            div.className = "flex flex-col gap-2 bg-blue-900/10 p-2 border border-blue-500/10";
            
            let topRow = `<div class="flex gap-2 items-center">
                <input type="text" value="${item.name}" onchange="editorData.${type}[${i}].name = this.value" class="bg-black border border-blue-500/20 p-1 text-xs flex-1">`;
            
            if (type === 'shop') topRow += `<input type="number" value="${item.price}" onchange="editorData.shop[${i}].price = parseInt(this.value)" class="bg-black border border-blue-500/20 p-1 text-xs w-16">`;
            else if (type !== 'titles') topRow += `<input type="number" value="${item.xp}" onchange="editorData.${type}[${i}].xp = parseInt(this.value)" class="bg-black border border-blue-500/20 p-1 text-xs w-12">`;
            
            if (type === 'hidden') topRow += `<input type="number" value="${item.gold}" onchange="editorData.hidden[${i}].gold = parseInt(this.value)" class="bg-black border border-blue-500/20 p-1 text-xs w-12">`;
            else if (type === 'daily' || type === 'urgent') topRow += `<input type="number" value="${item.gold || 0}" onchange="editorData.${type}[${i}].gold = parseInt(this.value)" class="bg-black border border-blue-500/20 p-1 text-xs w-12">`;

            if (type === 'titles') topRow += `<input type="text" value="${item.buff}" onchange="editorData.titles[${i}].buff = this.value" class="bg-black border border-blue-500/20 p-1 text-xs flex-1">`;
            if (type === 'skills_active') topRow += `<input type="number" value="${item.cooldown}" onchange="editorData.skills_active[${i}].cooldown = parseInt(this.value)" class="bg-black border border-blue-500/20 p-1 text-xs w-16">`;

            topRow += `<button onclick="editorData.${type}.splice(${i},1); refreshEditorUI()" class="text-red-500 px-2">&times;</button></div>`;

            let bottomRow = "";
            if (['hidden', 'shop', 'skills_active', 'skills_passive'].includes(type)) {
                const desc = item.description || "";
                bottomRow = `<input type="text" value="${desc}" placeholder="Description..." onchange="editorData.${type}[${i}].description = this.value" class="bg-black border border-blue-500/10 p-1 text-[10px] w-full opacity-70">`;
            }

            div.innerHTML = topRow + bottomRow;
            container.appendChild(div);
        });
    };

    buildList('edit-daily-list', editorData.daily, 'daily');
    buildList('edit-urgent-list', editorData.urgent, 'urgent');
    buildList('edit-hidden-list', editorData.hidden, 'hidden');
    buildList('edit-shop-list', editorData.shop, 'shop');
    buildList('edit-titles-list', editorData.titles, 'titles');
    buildList('edit-active-skills-list', editorData.skills_active, 'skills_active');
    buildList('edit-passive-skills-list', editorData.skills_passive, 'skills_passive');
}

function addEditorQuest(type) {
    const newQ = { id: Date.now(), name: "New Quest", xp: 50, gold: 10 };
    if (type === 'hidden') newQ.description = "Extra effort";
    editorData[type].push(newQ);
    refreshEditorUI();
}

function addEditorShopItem() {
    editorData.shop.push({ id: Date.now(), name: "New Item", price: 100, description: "Description" });
    refreshEditorUI();
}

function addEditorTitle() {
    editorData.titles.push({ id: Date.now(), name: "New Title", buff: "+10% Stats", active: false });
    refreshEditorUI();
}

function addEditorSkill(type) {
    const key = `skills_${type}`;
    const newS = { id: Date.now(), name: "New Skill", description: "Desc" };
    if (type === 'active') newS.cooldown = 60;
    else newS.level = 1;
    editorData[key].push(newS);
    refreshEditorUI();
}

async function saveAllQuests() {
    const res = await fetch('/api/update-all-quests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editorData)
    });
    if (res.ok) { alert("SYSTEM: Config Saved."); updateUI(); }
}

async function completeAction(url) {
    const res = await fetch(url, { method: 'POST' });
    if (res.ok) updateUI();
}

async function allocateStat(stat) {
    const res = await fetch(`/api/allocate-stat/${stat}`, { method: 'POST' });
    if (res.ok) updateUI();
}

function switchTab(id) {
    ['status', 'skills', 'quests', 'inventory', 'shop', 'editor'].forEach(t => {
        document.getElementById(`content-${t}`).classList.add('hidden');
        document.getElementById(`tab-${t}`).classList.remove('active');
    });
    document.getElementById(`content-${id}`).classList.remove('hidden');
    document.getElementById(`tab-${id}`).classList.add('active');
    
    if (id === 'editor') {
        renderEditorData(true);
    }
}

// Initial Load
updateUI();
setInterval(updateUI, 1000); // Faster update for cooldowns
