import os
import json
import logging
import time
import shutil
from datetime import datetime
from typing import List, Optional, Dict
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

DATA_DIR = os.getenv("DATA_DIR", "database")
DB_FILE = os.path.join(DATA_DIR, "player.json")

# Models for Request Bodies
class QuestBase(BaseModel):
    id: int
    name: str
    xp: int
    gold: int

class HiddenQuestUpdate(BaseModel):
    id: int
    name: str
    xp: int
    gold: int
    description: str

class ShopItem(BaseModel):
    id: int
    name: str
    price: int
    description: str

class Skill(BaseModel):
    id: int
    name: str
    description: str
    cooldown: Optional[int] = 0
    level: Optional[int] = 0
    max_level: Optional[int] = 5
    cost: Optional[int] = 1

class Title(BaseModel):
    id: int
    name: str
    buff: str
    active: bool

class AllQuestsUpdate(BaseModel):
    daily: List[QuestBase]
    urgent: List[QuestBase]
    hidden: List[HiddenQuestUpdate]
    shop: List[ShopItem]
    titles: List[Title]
    skills_active: List[Skill]
    skills_passive: List[Skill]

def load_player():
    os.makedirs(DATA_DIR, exist_ok=True)
    
    # Automatic seeding: if persistent file is missing or empty, copy from initial_player.json
    if not os.path.exists(DB_FILE) or os.path.getsize(DB_FILE) == 0:
        seed_source = "initial_player.json"
        if os.path.exists(seed_source):
            try:
                shutil.copy(seed_source, DB_FILE)
                print(f"Seeded {DB_FILE} from {seed_source}")
            except Exception as e:
                print(f"Failed to seed {DB_FILE}: {e}")

    if not os.path.exists(DB_FILE):
        player = {}
    else:
        with open(DB_FILE, "r") as f:
            try:
                player = json.load(f)
            except (json.JSONDecodeError, ValueError):
                player = {}
    
    # Ensure all required fields exist
    if "level" not in player: player["level"] = 1
    if "xp" not in player: player["xp"] = 0
    if "gold" not in player: player["gold"] = 0
    if "stat_points" not in player: player["stat_points"] = 0
    if "skill_points" not in player: player["skill_points"] = 0
    if "rank" not in player: player["rank"] = "E"
    if "job" not in player: player["job"] = "Unemployed"
    if "stats" not in player:
        player["stats"] = {"strength": 10, "agility": 10, "vitality": 10, "sense": 10}
    if "inventory" not in player: player["inventory"] = []
    if "shop" not in player: player["shop"] = []
    if "titles" not in player: player["titles"] = []
    if "skills" not in player: 
        player["skills"] = {"active": [], "passive": []}
    if "quests" not in player: player["quests"] = []
    if "urgent_quests" not in player: player["urgent_quests"] = []
    if "hidden_quests" not in player: player["hidden_quests"] = []
    if "penalty_active" not in player: player["penalty_active"] = False
    
    last_login = player.get("last_login", datetime.now().strftime("%Y-%m-%d"))
    today = datetime.now().strftime("%Y-%m-%d")
    
    if last_login != today:
        # Penalty check only for daily quests
        incomplete = any(not q["completed"] for q in player["quests"])
        player["penalty_active"] = incomplete
        for q in player["quests"]:
            q["completed"] = False
        player["last_login"] = today
        save_player_as_is(player)
        
    return player

def save_player_as_is(data):
    os.makedirs(os.path.dirname(DB_FILE), exist_ok=True)
    with open(DB_FILE, "w") as f:
        json.dump(data, f, indent=4)

def calculate_xp_threshold(level):
    return int(100 * (level ** 1.5))

def update_rank(level):
    if level >= 100: return "S"
    if level >= 80: return "A"
    if level >= 60: return "B"
    if level >= 40: return "C"
    if level >= 20: return "D"
    return "E"

def add_rewards(player, xp, gold):
    player["xp"] += xp
    player["gold"] += gold
    threshold = calculate_xp_threshold(player["level"])
    while player["xp"] >= threshold:
        player["xp"] -= threshold
        player["level"] += 1
        player["stat_points"] += 3
        player["skill_points"] += 1
        player["rank"] = update_rank(player["level"])
        threshold = calculate_xp_threshold(player["level"])

@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request):
    player = load_player()
    return templates.TemplateResponse(request=request, name="index.html", context={"player": player})

@app.get("/api/status")
async def get_status():
    return load_player()

@app.post("/api/complete-task/{task_id}")
async def complete_task(task_id: int):
    player = load_player()
    for quest in player["quests"]:
        if quest["id"] == task_id and not quest["completed"]:
            quest["completed"] = True
            add_rewards(player, quest["xp"], quest.get("gold", 0))
            
            # Check if all daily quests are now completed to clear penalty
            if all(q["completed"] for q in player["quests"]):
                player["penalty_active"] = False
                
            save_player_as_is(player)
            return player
    raise HTTPException(status_code=400, detail="Task not found or completed")

@app.post("/api/complete-urgent/{task_id}")
async def complete_urgent(task_id: int):
    player = load_player()
    for quest in player["urgent_quests"]:
        if quest["id"] == task_id and not quest["completed"]:
            quest["completed"] = True
            add_rewards(player, quest["xp"], quest.get("gold", 0))
            save_player_as_is(player)
            return player
    raise HTTPException(status_code=400, detail="Urgent quest not found")

@app.post("/api/claim-hidden/{task_id}")
async def claim_hidden(task_id: int):
    player = load_player()
    for quest in player["hidden_quests"]:
        if quest["id"] == task_id and not quest.get("claimed"):
            quest["claimed"] = True
            add_rewards(player, quest["xp"], quest.get("gold", 0))
            save_player_as_is(player)
            return player
    raise HTTPException(status_code=400, detail="Hidden quest not found")

@app.post("/api/buy-item/{item_id}")
async def buy_item(item_id: int):
    player = load_player()
    item = next((i for i in player["shop"] if i["id"] == item_id), None)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    
    if player["gold"] < item["price"]:
        raise HTTPException(status_code=400, detail="Not enough gold")
    
    player["gold"] -= item["price"]
    
    # Add to inventory
    inv_item = next((i for i in player["inventory"] if i["id"] == item_id), None)
    if inv_item:
        inv_item["count"] += 1
    else:
        player["inventory"].append({
            "id": item["id"],
            "name": item["name"],
            "description": item.get("description", ""),
            "count": 1
        })
    
    save_player_as_is(player)
    return player

@app.post("/api/use-item/{item_id}")
async def use_item(item_id: int):
    player = load_player()
    inv_item = next((i for i in player["inventory"] if i["id"] == item_id), None)
    if not inv_item or inv_item["count"] <= 0:
        raise HTTPException(status_code=400, detail="Item not in inventory")
    
    inv_item["count"] -= 1
    if inv_item["count"] == 0:
        player["inventory"] = [i for i in player["inventory"] if i["id"] != item_id]
    
    # Logic for items (like random boxes) could be expanded here
    save_player_as_is(player)
    return player

@app.post("/api/use-skill/{skill_id}")
async def use_skill(skill_id: int):
    player = load_player()
    skill = next((s for s in player["skills"]["active"] if s["id"] == skill_id), None)
    if not skill:
        raise HTTPException(status_code=404, detail="Skill not found")
    
    now = time.time()
    if now - skill.get("last_used", 0) < skill.get("cooldown", 0):
        raise HTTPException(status_code=400, detail="Skill on cooldown")
    
    skill["last_used"] = now
    save_player_as_is(player)
    return player

@app.post("/api/toggle-title/{title_id}")
async def toggle_title(title_id: int):
    player = load_player()
    for title in player["titles"]:
        if title["id"] == title_id:
            title["active"] = not title["active"]
        else:
            title["active"] = False # Only one active title at a time
    save_player_as_is(player)
    return player

@app.post("/api/update-all-quests")
async def update_all_quests(data: AllQuestsUpdate):
    player = load_player()
    
    # Update Quests while preserving completion status
    def update_list(old_list, new_list, key="id", status_key="completed"):
        updated = []
        for item in new_list:
            old_item = next((oi for oi in old_list if oi[key] == item.id), None)
            item_dict = item.dict()
            if old_item:
                item_dict[status_key] = old_item.get(status_key, False)
            else:
                item_dict[status_key] = False
            updated.append(item_dict)
        return updated

    player["quests"] = update_list(player["quests"], data.daily)
    player["urgent_quests"] = update_list(player["urgent_quests"], data.urgent)
    player["hidden_quests"] = update_list(player.get("hidden_quests", []), data.hidden, status_key="claimed")
    
    # Update Shop, Titles, and Skills directly (they don't have transient status usually, or we replace them)
    player["shop"] = [item.dict() for item in data.shop]
    player["titles"] = [title.dict() for title in data.titles]
    
    # For skills, we might want to preserve level/last_used
    def update_skills(old_list, new_list):
        updated = []
        for s in new_list:
            old = next((os for os in old_list if os["id"] == s.id), None)
            s_dict = s.dict()
            if old:
                s_dict["level"] = old.get("level", 0)
                s_dict["last_used"] = old.get("last_used", 0)
            else:
                s_dict["level"] = 0
                s_dict["last_used"] = 0
            updated.append(s_dict)
        return updated

    player["skills"]["active"] = update_skills(player["skills"].get("active", []), data.skills_active)
    player["skills"]["passive"] = update_skills(player["skills"].get("passive", []), data.skills_passive)

    save_player_as_is(player)
    return player

@app.post("/api/allocate-stat/{stat}")
async def allocate_stat(stat: str):
    player = load_player()
    if player["stat_points"] > 0 and stat in player["stats"]:
        player["stats"][stat] += 1
        player["stat_points"] -= 1
        save_player_as_is(player)
        return player
    raise HTTPException(status_code=400, detail="Invalid stat or points")

if __name__ == "__main__":
    import uvicorn
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", 8001))
    uvicorn.run(app, host=host, port=port)
