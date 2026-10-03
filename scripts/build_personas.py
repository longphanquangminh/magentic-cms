from __future__ import annotations
"""Project MatrAIx Persona-1M sample records into Sanity `persona` documents.

Input : data/matraix_sample.parquet  (MatrAIx2026/MatrAIx_Persona_1M -> sample/sample.parquet)
Output: data/personas.ndjson         (one Sanity document per line)

We keep the attributes that plausibly drive how someone reacts to a social post
(personality, attitudes toward brands/influencers/social media, politics, religiosity,
income, tone preference...). Every persona keeps a pointer back to the MatrAIx record
(source + source_record_id) so a simulated comment is always traceable to a record.
"""
import hashlib
import json
import random
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "matraix_sample.parquet"
OUT = ROOT / "data" / "personas.ndjson"
LIMIT = int(sys.argv[1]) if len(sys.argv) > 1 else 400

ADULT = {"18-24", "25-34", "35-44", "45-54", "55-64", "65-74", "75-84", "85+"}
NULLS = {None, "null", "None", "Unknown", "Unfamiliar", "nan"}

# attribute -> (sanity field group, field name)
TRAITS = {
    "bfi2_domain_extraversion": "extraversion",
    "bfi2_domain_agreeableness": "agreeableness",
    "bfi2_domain_negative_emotionality": "negativeEmotionality",
    "big5_anger": "anger",
    "big5_trust": "trust",
    "big5_liberalism": "liberalism",
    "big5_sympathy": "sympathy",
    "big5_cheerfulness": "cheerfulness",
    "cog_ambiguity_tolerance": "ambiguityTolerance",
}
ATTITUDES = {
    "att_social_media": "socialMedia",
    "att_influencers": "influencers",
    "att_brand_loyalty": "brandLoyalty",
    "att_consumerism": "consumerism",
    "att_online_reviews": "onlineReviews",
    "att_organized_religion": "organizedReligion",
    "att_traditional_gender_roles": "traditionalGenderRoles",
    "trust_level": "trustLevel",
}
CORE = {
    "region": "region",
    "primary_language": "primaryLanguage",
    "age_bracket": "ageBracket",
    "demo_generation": "generation",
    "gender_identity": "gender",
    "urbanicity": "urbanicity",
    "demo_household_income": "householdIncome",
    "highest_education": "education",
    "political_lean": "politicalLean",
    "demo_political_engagement": "politicalEngagement",
    "religiosity": "religiosity",
    "demo_religion_affiliation": "religion",
    "lstyle_shopping_style": "shoppingStyle",
    "lstyle_social_battery": "socialBattery",
    "lstyle_news_freq": "newsFrequency",
    "tone_expected": "tone",
    "emotional_state": "mood",
    "risk_tolerance": "riskTolerance",
    "topic_social_media": "interestSocialMedia",
    "topic_politics": "interestPolitics",
    "domain": "workDomain",
    "role_function": "role",
}

FIRST = {
    "North America": ["jess", "mike", "tay", "dre", "kayla", "bren", "marcus", "sam", "olivia", "tyler"],
    "Latin America": ["sofi", "mateo", "vale", "diego", "cami", "lucas", "gabi", "juanpa"],
    "Western Europe": ["lena", "theo", "clara", "jonas", "manon", "luca", "freya", "noah"],
    "Southern Europe": ["giulia", "marco", "ines", "pablo"],
    "Eastern Europe": ["anya", "dmitri", "kasia", "pavel", "irina"],
    "East Asia": ["mei", "haruto", "jiwoo", "lin", "yuki", "wei", "minjun", "sora"],
    "Southeast Asia": ["linh", "minh", "anh", "putri", "rizal", "mai", "khoa", "nina", "tuan", "thao"],
    "South Asia": ["priya", "arjun", "ananya", "rohan", "farhan", "isha", "dev", "nadia"],
    "MENA": ["layla", "omar", "yasmin", "karim", "noor", "amir"],
    "Sub-Saharan Africa": ["amara", "kofi", "zuri", "tunde", "ama", "jabari", "nia", "chidi"],
    "Oceania": ["mia", "jack", "aroha", "liam"],
}
SUFFIX = ["", "_", ".", "x", "_irl", "_real", "official", "thoughts", "_says", "vibes"]


def clean(v):
    if v is None:
        return None
    if isinstance(v, float) and pd.isna(v):
        return None
    s = str(v).strip()
    return None if s in NULLS else s


def rng_for(key: str) -> random.Random:
    return random.Random(int(hashlib.sha1(key.encode()).hexdigest()[:12], 16))


def make_handle(rec_id: str, region: str | None) -> tuple[str, str]:
    r = rng_for(rec_id)
    name = r.choice(FIRST.get(region or "", sum(FIRST.values(), [])))
    handle = f"{name}{r.choice(SUFFIX)}{r.randint(1, 999) if r.random() < 0.7 else ''}"
    return handle.replace("..", "."), name.capitalize()


def summary(core: dict, traits: dict, att: dict) -> str:
    bits = []
    who = " ".join(x for x in [core.get("ageBracket") and f"{core['ageBracket']} y/o", core.get("gender")] if x)
    bits.append(who or "Adult")
    if core.get("region"):
        bits.append(f"in {core['region']}")
    if core.get("urbanicity"):
        bits.append(f"({core['urbanicity'].lower()})")
    s = " ".join(bits) + "."
    extra = []
    if core.get("householdIncome"):
        extra.append(f"household income {core['householdIncome']}")
    if core.get("politicalLean"):
        extra.append(f"politically {core['politicalLean'].lower()}")
    if core.get("religiosity"):
        extra.append(core["religiosity"].lower())
    if core.get("shoppingStyle"):
        extra.append(core["shoppingStyle"].lower())
    if att.get("influencers"):
        extra.append(f"{att['influencers'].lower()} about influencers")
    if att.get("socialMedia"):
        extra.append(f"{att['socialMedia'].lower()} about social media")
    if traits.get("agreeableness"):
        extra.append(f"agreeableness {traits['agreeableness'].lower()}")
    if traits.get("negativeEmotionality"):
        extra.append(f"negative emotionality {traits['negativeEmotionality'].lower()}")
    if core.get("tone"):
        extra.append(f"writes {core['tone'].lower()}")
    return s + (" " + "; ".join(extra).capitalize() + "." if extra else "")


def main():
    df = pd.read_parquet(SRC)
    df = df[df["age_bracket"].isin(ADULT)]
    df = df[df["source"] != "wiki"]  # skip Wikidata-derived profiles of public figures
    # prefer records that actually carry the attitude/personality signal we use
    signal_cols = list(TRAITS) + list(ATTITUDES) + ["political_lean", "tone_expected"]
    df = df.assign(_signal=df[signal_cols].apply(lambda r: sum(clean(x) is not None for x in r), axis=1))
    df = df.sort_values("_signal", ascending=False).head(LIMIT)

    n = 0
    seen = set()
    with OUT.open("w") as f:
        for _, row in df.iterrows():
            rec_id = clean(row.get("source_record_id")) or f"{row['source']}#{int(row['source_row_index'])}"
            core = {v: clean(row.get(k)) for k, v in CORE.items()}
            traits = {v: clean(row.get(k)) for k, v in TRAITS.items()}
            att = {v: clean(row.get(k)) for k, v in ATTITUDES.items()}
            core = {k: v for k, v in core.items() if v}
            traits = {k: v for k, v in traits.items() if v}
            att = {k: v for k, v in att.items() if v}
            handle, display = make_handle(rec_id, core.get("region"))
            while handle in seen:
                handle += str(rng_for(handle).randint(0, 9))
            seen.add(handle)
            doc = {
                "_id": "persona-" + hashlib.sha1(rec_id.encode()).hexdigest()[:16],
                "_type": "persona",
                "handle": handle,
                "displayName": display,
                "avatarSeed": hashlib.md5(rec_id.encode()).hexdigest()[:8],
                "matraix": {
                    "_type": "matraixRef",
                    "dataset": "MatrAIx2026/MatrAIx_Persona_1M",
                    "source": str(row["source"]),
                    "recordId": rec_id,
                    "rowIndex": int(row["source_row_index"]),
                    "populatedAttributes": int(row["populated_attribute_count"]),
                },
                **core,
                "traits": {"_type": "personaTraits", **traits},
                "attitudes": {"_type": "personaAttitudes", **att},
                "summary": summary(core, traits, att),
            }
            f.write(json.dumps(doc, ensure_ascii=False) + "\n")
            n += 1
    print(f"wrote {n} personas -> {OUT}")


if __name__ == "__main__":
    main()
