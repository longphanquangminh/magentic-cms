"""Seed the Sanity dataset: personas (from MatrAIx), workflow definition, demo brands/audiences/posts.

Usage:
  SANITY_PROJECT_ID=... SANITY_DATASET=production SANITY_API_TOKEN=... python3 scripts/seed.py
  python3 scripts/seed.py --reset-posts   # also put demo posts back to draft rev 1
"""
import json
import os
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PID = os.environ["SANITY_PROJECT_ID"]
DS = os.environ.get("SANITY_DATASET", "production")
TOKEN = os.environ["SANITY_API_TOKEN"]
URL = f"https://{PID}.api.sanity.io/v2025-02-19/data/mutate/{DS}?visibility=sync"


def mutate(muts):
    req = urllib.request.Request(
        URL,
        data=json.dumps({"mutations": muts}).encode(),
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


def ref(i):
    return {"_type": "reference", "_ref": i}


# ---------------------------------------------------------------- workflow (process as data)
STAGES = [
    ("draft", "Draft", "default"),
    ("simulating", "Simulating", "primary"),
    ("needs_revision", "Needs revision", "critical"),
    ("ready_for_review", "Ready for review", "caution"),
    ("approved", "Approved", "positive"),
    ("published", "Published", "positive"),
]
TRANSITIONS = [
    ("start_simulation", "Run simulation", ["draft", "needs_revision", "ready_for_review"], "simulating", ["human", "agent"], False),
    ("flag_risk", "Flag risk", ["simulating"], "needs_revision", ["agent"], False),
    ("clear_for_review", "Clear for review", ["simulating"], "ready_for_review", ["agent"], False),
    ("apply_revision", "Apply suggested revision", ["needs_revision", "ready_for_review"], "draft", ["human", "agent"], False),
    ("approve", "Approve", ["ready_for_review"], "approved", ["human"], False),
    ("override_approve", "Approve anyway", ["needs_revision"], "approved", ["human"], True),
    ("publish", "Publish", ["approved"], "published", ["human"], False),
    ("send_back", "Send back to draft", ["ready_for_review", "approved", "needs_revision"], "draft", ["human"], False),
]
workflow = {
    "_id": "workflow.socialPost",
    "_type": "workflow",
    "title": "Social post: simulate before you publish",
    "appliesTo": "post",
    "stages": [{"_key": s, "_type": "stage", "id": s, "title": t, "tone": tone} for s, t, tone in STAGES],
    "transitions": [
        {"_key": i, "_type": "transition", "id": i, "title": t, "from": f, "to": to, "actors": a, "requiresNote": n}
        for i, t, f, to, a, n in TRANSITIONS
    ],
}

# ---------------------------------------------------------------- brands
brands = [
    {
        "_id": "brand-saveo",
        "_type": "brand",
        "name": "Saveo",
        "handle": "saveo.app",
        "voice": "Warm, practical, a little funny. We're the friend who's good with money and never makes you feel bad about it.",
        "audience": "People 22-40 living paycheck to paycheck or trying to stop. Many are students, gig workers and young parents.",
        "redLines": [
            "Never shame or mock people for being broke, in debt, or for small pleasures.",
            "Never promise specific returns or imply guaranteed savings.",
            "No 'just stop buying coffee' advice — rent and wages are the problem, not lattes.",
        ],
        "pastIncidents": [
            {
                "_key": "avo",
                "_type": "incident",
                "title": "The avocado-toast ad",
                "date": "2025-03-11",
                "whatHappened": "A promo told millennials to skip avocado toast to afford a house. It got ~4k angry quote-posts in a day, "
                "trended as 'Saveo thinks we're poor because of brunch', and we apologised two days later.",
                "lesson": "Punching down on small treats reads as blaming people for structural problems.",
            },
            {
                "_key": "guar",
                "_type": "incident",
                "title": "'Guaranteed $500' email",
                "date": "2025-11-02",
                "whatHappened": "A subject line said 'Guaranteed $500 saved'. Users reported it as misleading; app-store reviews dipped.",
                "lesson": "Use averages with context, never guarantees.",
            },
        ],
    },
    {
        "_id": "brand-bolt",
        "_type": "brand",
        "name": "Bolt Burgers",
        "handle": "boltburgers",
        "voice": "Loud, hungry, late-night energy. Playful but never at someone else's expense.",
        "audience": "Students and night-shift workers in 14 countries, including large Muslim-majority markets in MENA and Southeast Asia.",
        "redLines": [
            "Respect religious and cultural observances in every market we operate in.",
            "No pork promotions in halal-certified markets.",
        ],
        "pastIncidents": [
            {
                "_key": "diwali",
                "_type": "incident",
                "title": "Diwali 'beef festival' meme",
                "date": "2024-10-30",
                "whatHappened": "A regional account posted a Diwali beef-burger meme. It was pulled within 6 hours after boycott calls in India.",
                "lesson": "Festival tie-ins must be checked against the festival's own customs.",
            }
        ],
    },
]

audiences = [
    {"_id": "aud-everyone", "_type": "audience", "title": "Everyone", "description": "The whole persona pool.", "groqFilter": "", "sampleSize": 60},
    {
        "_id": "aud-young",
        "_type": "audience",
        "title": "Young & online",
        "description": "Gen Z and Millennials.",
        "groqFilter": 'generation in ["Gen Z", "Millennial"]',
        "sampleSize": 60,
    },
    {
        "_id": "aud-budget",
        "_type": "audience",
        "title": "Budget-conscious",
        "description": "Lower household income or self-described bargain hunters. Saveo's core market.",
        "groqFilter": 'householdIncome in ["<$25k", "$25k-50k"] || shoppingStyle == "Bargain hunter"',
        "sampleSize": 60,
    },
    {
        "_id": "aud-global-night",
        "_type": "audience",
        "title": "Global late-night crowd",
        "description": "Everyone outside North America — Bolt's international markets.",
        "groqFilter": 'region != "North America"',
        "sampleSize": 60,
    },
]

posts = [
    {
        "_id": "post-saveo-latte",
        "_type": "post",
        "title": "Saveo — 'Still broke at 30?' promo",
        "brand": ref("brand-saveo"),
        "platform": "instagram",
        "audience": ref("aud-budget"),
        "body": "Still broke at 30? 😂 Maybe skip the daily latte, bestie. Saveo users who cut 'small luxuries' save $3,000 a year. "
        "No excuses. Download now 💸 #NoExcuses #AdultingWin",
        "mediaDescription": "A smug cartoon piggy bank knocking an iced latte off a table.",
    },
    {
        "_id": "post-saveo-subs",
        "_type": "post",
        "title": "Saveo — forgotten subscriptions",
        "brand": ref("brand-saveo"),
        "platform": "instagram",
        "audience": ref("aud-budget"),
        "body": "Prices went up. Your paycheck didn't. 🫠 Saveo scans your account for subscriptions you forgot about — "
        "people in our beta found an average of $27/month in their first week. No judgment, just receipts. 🧾",
        "mediaDescription": "Phone screen listing 'Gym you never go to — $39', 'Streaming #4 — $12', with a big CANCEL button.",
    },
    {
        "_id": "post-bolt-ramadan",
        "_type": "post",
        "title": "Bolt — Ramadan late-night promo",
        "brand": ref("brand-bolt"),
        "platform": "facebook",
        "audience": ref("aud-global-night"),
        "body": "Ramadan nights hit different 🌙 Our Midnight Bacon Feast is BACK — the perfect way to break your fast after iftar! "
        "2-for-1 every night this month, all locations. 🥓🍔",
        "mediaDescription": "Crescent moon and lanterns behind a double bacon cheeseburger dripping with cheese.",
    },
]


def main():
    reset = "--reset-posts" in sys.argv
    personas = [json.loads(l) for l in (ROOT / "data" / "personas.ndjson").open()]
    for i in range(0, len(personas), 100):
        mutate([{"createOrReplace": p} for p in personas[i : i + 100]])
        print(f"personas {min(i + 100, len(personas))}/{len(personas)}")
    mutate([{"createOrReplace": d} for d in [workflow, *brands, *audiences]])
    print("workflow, brands, audiences ok")
    muts = []
    for p in posts:
        muts.append({"createIfNotExists": {**p, "stage": "draft", "revision": 1}})
        if reset:
            muts.append({"patch": {"id": p["_id"], "set": {"body": p["body"], "stage": "draft", "revision": 1}, "unset": ["latestRun"]}})
    mutate(muts)
    print("posts ok", "(reset)" if reset else "")


if __name__ == "__main__":
    main()
