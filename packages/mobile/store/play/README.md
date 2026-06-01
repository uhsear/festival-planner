# Play Store automation

Drives the API-automatable parts of a Google Play release for `us.festie.app`.

## What is / isn't automatable (verified 2026-06-01)

A **first-time** submission is partly manual by Google's design:

| Step | Automatable? |
|------|--------------|
| Create app entry in Play Console | ❌ No API — do once by hand |
| First AAB upload + Play App Signing opt-in | ❌ Manual (Google requires first upload via Console) |
| Content rating (IARC) questionnaire | ❌ No API |
| App content (privacy URL, target audience, ads) | ❌ No API |
| Store listing text | ✅ `publish.py push-listing` |
| Icon / feature graphic / screenshots | ✅ `publish.py push-images` |
| Data safety form | ⚠️ `publish.py push-data-safety` (experimental, CSV) |
| Subsequent release uploads | ✅ `eas submit -p android --profile production --latest` |

## Setup

```bash
pip install --user google-auth requests
export FESTIE_PLAY_SA_KEY="/path/to/play-sa-key.json"   # never commit this key
```

The Google Play service account must be invited under **Play Console → Users & permissions**
with release permissions (can take up to ~24h to propagate).

## Commands

```bash
python publish.py check                         # verify app exists + SA access
python publish.py push-listing                  # push listing.en-US.json
python publish.py push-images                   # upload images/<lang>/<imageType>/*.png
python publish.py push-data-safety ds.csv       # experimental
python publish.py submit app.aab --track internal --status draft
```

## Layout

- `listing.en-US.json` — title (≤30), shortDescription (≤80), fullDescription (≤4000).
- `images/<lang>/<imageType>/*.png` — e.g. `images/en-US/icon/`, `.../featureGraphic/`,
  `.../phoneScreenshots/`. Each push **replaces** all images of that type for the locale.

Play asset specs: icon 512×512 PNG (32-bit), feature graphic 1024×500, ≥2 phone screenshots
(min 320px, ≤3840px, ≤8MB each).
